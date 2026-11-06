"""XLSX conversion sheet by sheet through one anydoc call (Req 1.3), after the cell-count pre-check (Req 2.6).

anydoc writes a "## <sheet name>" heading per sheet only when the workbook lists two or more
sheets, and leaves out hidden, empty and chart sheets. Each name is therefore replaced with a
marker carrying a per-call random token, hidden sheets are made visible, and the output is cut
at the marker headings.
"""

from __future__ import annotations

import io
import logging
import re
import secrets
import zipfile
from xml.etree.ElementTree import Element, tostring

from app.conversion.archive_guard import _UNREADABLE_PART_ERRORS, copy_part, inspect_archive, read_part
from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits
from app.conversion.office import convert_office
from app.conversion.ooxml_xml import local_name, parse, register_prefixes
from app.schemas import PageInfo

logger = logging.getLogger(__name__)

_WORKBOOK = "xl/workbook.xml"
# Hex only: anydoc prints headings verbatim, and no Markdown escaping touches alphanumerics.
_TOKEN_BYTES = 16
_MIB = 1024 * 1024
_CHUNK_BYTES = 64 * 1024
# Longest start tag head kept between chunks; a tag head longer than this cannot be a cell.
_MAX_TAG_HEAD_BYTES = 64

# anydoc holds the whole sheet grid in memory, so parsing the XML here to count cells would
# defeat the purpose; a byte scan keeps memory flat. The optional prefix covers "<x:c ...>"
# written by non-Excel producers. Overcounting (CDATA or comments containing "<c ") only errs
# toward rejecting.
_CELL_START = re.compile(rb"<(?:[A-Za-z_][\w.-]*:)?c[\s/>]")
_UTF16_BOMS = (b"\xff\xfe", b"\xfe\xff")


def convert_xlsx(data: bytes, limits: ConversionLimits) -> list[PageInfo]:
    """Return one element per sheet that has text, numbered by its position in workbook.xml.

    Packages that fail the ZIP pre-check (encrypted OOXML, legacy XLS) go to anydoc whole and
    come back as a single unnumbered element.
    """
    archive = inspect_archive(data, _WORKBOOK, limits)
    if archive is None:
        return [PageInfo(pageNumber=None, label=None, content=convert_office(data, "xlsx"))]
    token = secrets.token_hex(_TOKEN_BYTES)
    try:
        enforce_cell_limit(archive, limits)
        package, names = _marked_package(archive, token, limits)
    finally:
        archive.close()
    return _split(convert_office(package, "xlsx"), token, names)


def enforce_cell_limit(archive: zipfile.ZipFile, limits: ConversionLimits) -> None:
    """Raise limit_exceeded when all worksheets together hold more than max_xlsx_cells cells.

    The caller owns the archive (already past the ZIP pre-check). Decompression is bounded by
    the archive size limit counted on bytes actually produced, not on the declared sizes.
    """
    budget = limits.max_archive_uncompressed_mb * _MIB
    cells = 0
    for info in _scannable_parts(archive):
        for count, produced in _scan_part(archive, info):
            cells += count
            budget -= produced
            if cells > limits.max_xlsx_cells:
                raise ConversionError("limit_exceeded", "workbook has too many cells")
            if budget < 0:
                raise ConversionError("limit_exceeded", "worksheets expand beyond the size limit")


def _scannable_parts(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    # anydoc finds sheets through workbook.xml.rels, so a sheet may sit at any path, with any
    # name or extension; every part except relationship files is scanned instead of guessing
    # which ones are sheets. Duplicate names are each scanned.
    return [info for info in archive.infolist() if not info.filename.lower().endswith(".rels") and not info.is_dir()]


def _scan_part(archive: zipfile.ZipFile, info: zipfile.ZipInfo):  # noqa: ANN202 - generator of (cells, bytes read)
    carry = b""
    try:
        with archive.open(info) as part:
            first = True
            while chunk := part.read(_CHUNK_BYTES):
                if first and chunk.startswith(_UTF16_BOMS):
                    # The byte patterns are UTF-8 only; anydoc would read the part as UTF-16, so refuse it.
                    raise ConversionError("malformed", "archive part uses an unsupported encoding")
                first = False
                buffer = carry + chunk
                # A tag head at the end may continue in the next chunk, so it is counted later.
                split = buffer.rfind(b"<")
                if split == -1 or len(buffer) - split > _MAX_TAG_HEAD_BYTES:
                    split = len(buffer)
                count = sum(1 for m in _CELL_START.finditer(buffer) if m.start() < split)
                carry = buffer[split:]
                yield count, len(chunk)
            yield len(_CELL_START.findall(carry)), 0
    except RuntimeError as exc:
        if bool(info.flag_bits & 0x1):
            raise ConversionError("encrypted", "archive part is encrypted") from exc
        raise ConversionError("malformed", "archive part could not be read") from exc
    except _UNREADABLE_PART_ERRORS as exc:
        raise ConversionError("malformed", "archive part could not be read") from exc


def _marker(token: str, position: int) -> str:
    return f"ZZ{token}{position}ZZ"


def _marked_package(archive: zipfile.ZipFile, token: str, limits: ConversionLimits) -> tuple[bytes, list[str | None]]:
    """The package with every sheet renamed to its marker and shown; the original names in order."""
    budget = limits.max_archive_uncompressed_mb * _MIB
    workbook_xml = read_part(archive, _WORKBOOK, budget)
    budget -= len(workbook_xml)
    root = parse(workbook_xml, "workbook.xml")
    register_prefixes(workbook_xml, "workbook.xml")
    sheets = _sheet_entries(root)
    if len(sheets) > limits.max_archive_entries:
        raise ConversionError("limit_exceeded", "sheet list is longer than the archive entry limit")
    names: list[str | None] = []
    for position, sheet in enumerate(sheets, start=1):
        names.append(sheet.get("name"))
        sheet.set("name", _marker(token, position))
        if "state" in sheet.attrib:
            sheet.set("state", "visible")
    # Only <sheet name> changes: defined names and formulas keep the old names, which anydoc
    # does not read when rendering cells.
    marked_workbook = tostring(root, encoding="UTF-8", xml_declaration=True)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as out:
        for name in _distinct_names(archive):
            source = archive.getinfo(name)
            entry = zipfile.ZipInfo(name, source.date_time)
            entry.compress_type = source.compress_type
            entry.external_attr = source.external_attr
            if name == _WORKBOOK:
                out.writestr(entry, marked_workbook)
                continue
            # Streamed: pivot caches and media are not counted as cells and may expand far
            # beyond the RSS limit, so only the compressed package is ever held.
            with out.open(entry, "w") as dest:
                budget -= copy_part(archive, name, dest, budget)
    return buf.getvalue(), names


def _distinct_names(archive: zipfile.ZipFile) -> list[str]:
    # Of duplicated names, readers (zipfile and anydoc alike) use the last entry, so one copy of
    # that entry keeps what anydoc sees.
    return list(dict.fromkeys(info.filename for info in archive.infolist()))


def _sheet_entries(root: Element) -> list[Element]:
    sheets = next((child for child in root if local_name(child.tag) == "sheets"), None)
    if sheets is None:
        return []
    return [child for child in sheets if local_name(child.tag) == "sheet"]


def _split(markdown: str, token: str, names: list[str | None]) -> list[PageInfo]:
    if len(names) == 1:
        return [PageInfo(pageNumber=1, label=names[0], content=_restored(markdown, token, names))]
    headings = list(re.finditer(rf"^## ZZ{token}(\d+)ZZ$", markdown, re.MULTILINE))
    positions = [int(heading.group(1)) for heading in headings]
    reason = None
    if len(re.findall(token, markdown)) != len(headings):
        reason = "a marker appears outside a sheet heading"
    elif any(not 1 <= position <= len(names) for position in positions):
        reason = "a marker names no sheet"
    elif positions != sorted(set(positions)):
        reason = "markers are out of workbook order"
    elif markdown[: headings[0].start() if headings else len(markdown)].strip():
        reason = "text precedes the first sheet heading"
    if reason is not None:
        # Names and text are file content, so only the reason is logged.
        logger.warning("XLSX sheet split fell back to the whole workbook: %s", reason)
        return [PageInfo(pageNumber=None, label=None, content=_restored(markdown, token, names))]

    pages = []
    for index, heading in enumerate(headings):
        end = headings[index + 1].start() if index + 1 < len(headings) else len(markdown)
        content = markdown[heading.end() : end].strip("\n")
        if content:
            position = positions[index]
            pages.append(PageInfo(pageNumber=position, label=names[position - 1], content=content))
    return pages


def _restored(markdown: str, token: str, names: list[str | None]) -> str:
    def original(match: re.Match[str]) -> str:
        position = int(match.group(1))
        return (names[position - 1] or "") if 1 <= position <= len(names) else ""

    return re.sub(rf"ZZ{token}(\d+)ZZ", original, markdown)
