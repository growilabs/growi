"""XLSX handling ahead of anydoc: the cell-count pre-check (Req 2.6)."""

from __future__ import annotations

import re
import zipfile

from app.conversion.archive_guard import _UNREADABLE_PART_ERRORS
from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits

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
