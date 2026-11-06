"""Document fixtures generated inside the test run.

Real documents are not committed (design.md → Allowed Dependencies); every
file here is built from scratch with the test-only libraries or the standard
library. The only exception is the legacy DOC / PPT pair under
``tests/fixtures/legacy/`` (see its README).

All fixtures are session-scoped and lazy: a file is built the first time a
test asks for it. Small fixtures return ``bytes``; large ones (``*_path``)
are written once under ``tmp_path_factory`` and returned as a ``Path`` so the
session does not keep tens of MB per file in memory.

Re-exported from ``tests/conftest.py`` so every test directory can use them.
"""

from __future__ import annotations

import io
import random
import re
import struct
import zipfile
import zlib
from collections.abc import Callable, Iterable
from pathlib import Path

import msoffcrypto.format.ooxml
import openpyxl
import pytest
import xlwt
from docx import Document
from docx.shared import Inches
from openpyxl.chart import BarChart, Reference
from pptx import Presentation
from pptx.util import Inches as PptxInches
from pypdf import PdfReader, PdfWriter

from app.config import Settings

LEGACY_DIR = Path(__file__).parent / "fixtures" / "legacy"
JAPANESE_SAMPLE = "障害対応メモ\n本番環境で発生した情報システムの障害"
OFFICE_PASSWORD = "office-test-password"  # noqa: S105 — test-only credential
PDF_USER_PASSWORD = "pdf-user-password"  # noqa: S105 — test-only credential
PDF_OWNER_PASSWORD = "pdf-owner-password"  # noqa: S105 — test-only credential
ENCRYPTED_MARKER = "encrypted marker"

_MIB = 1024 * 1024
# Read limits from field defaults: session fixtures run before the function-scoped
# token fixture, so Settings() cannot be instantiated here.
_MAX_XLSX_CELLS: int = Settings.model_fields["MAX_XLSX_CELLS"].default
_MAX_ARCHIVE_UNCOMPRESSED_MB: int = Settings.model_fields["MAX_ARCHIVE_UNCOMPRESSED_MB"].default

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _save(save: Callable[[io.BytesIO], object]) -> bytes:
    buf = io.BytesIO()
    save(buf)
    return buf.getvalue()


def _workbook_bytes(build: Callable[[openpyxl.Workbook], None]) -> bytes:
    wb = openpyxl.Workbook()
    build(wb)
    return _save(wb.save)


def _png_random_gray(side: int, rng: random.Random) -> bytes:
    """Return a valid grayscale PNG whose pixels are random (incompressible)."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    raw = b"".join(b"\x00" + rng.randbytes(side) for _ in range(side))
    ihdr = struct.pack(">IIBBBBB", side, side, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 0)) + chunk(b"IEND", b"")


def _random_images(count: int, side: int, seed: int) -> list[bytes]:
    rng = random.Random(seed)  # noqa: S311 — reproducible filler, not security
    return [_png_random_gray(side, rng) for _ in range(count)]


def _encrypt_ooxml(plain: bytes) -> bytes:
    out = io.BytesIO()
    msoffcrypto.format.ooxml.OOXMLFile(io.BytesIO(plain)).encrypt(OFFICE_PASSWORD, out)
    return out.getvalue()


def _rewrite_zip_member(base: bytes, dest: Path, member: str, chunks: Iterable[bytes]) -> None:
    """Copy ``base`` to ``dest`` replacing ``member`` with streamed ``chunks``."""
    with zipfile.ZipFile(io.BytesIO(base)) as src, zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as out:
        for info in src.infolist():
            if info.filename == member:
                with out.open(member, "w", force_zip64=True) as fh:
                    for part in chunks:
                        fh.write(part)
            else:
                out.writestr(info, src.read(info.filename))


def _zip_package(mimetype: str, members: dict[str, str]) -> bytes:
    """Build an ODF / EPUB container: ``mimetype`` first and stored, as the specs require."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(zipfile.ZipInfo("mimetype"), mimetype, compress_type=zipfile.ZIP_STORED)
        for name, body in members.items():
            zf.writestr(name, body)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Hand-assembled PDF
# ---------------------------------------------------------------------------


def _pdf_stream(dictionary: bytes, data: bytes) -> bytes:
    return b"<< " + dictionary + b" /Length %d >>\nstream\n" % len(data) + data + b"\nendstream"


def _build_pdf(page_bodies: list[tuple[bytes, bytes]], extra_objects: list[bytes]) -> bytes:
    """Assemble a PDF. Object 1 = catalog, 2 = pages, 3 = Helvetica, then ``extra_objects``.

    Each page is ``(resources, content_stream)``.
    """
    first_page = 4 + len(extra_objects)
    kids = b" ".join(b"%d 0 R" % (first_page + 2 * i) for i in range(len(page_bodies)))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [" + kids + b"] /Count %d >>" % len(page_bodies),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        *extra_objects,
    ]
    for i, (resources, content) in enumerate(page_bodies):
        content_ref = first_page + 2 * i + 1
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources "
            + resources
            + b" /Contents %d 0 R >>" % content_ref
        )
        objects.append(_pdf_stream(b"", content))

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref_at = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref_at)
    return bytes(out)


def make_text_pdf(page_texts: list[str]) -> bytes:
    font = b"<< /Font << /F1 3 0 R >> >>"
    pages = [(font, b"BT /F1 24 Tf 72 700 Td (" + text.encode("ascii") + b") Tj ET") for text in page_texts]
    return _build_pdf(pages, [])


def _encrypt_pdf(plain: bytes, *, user_password: str, owner_password: str) -> bytes:
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(plain)))
    # RC4-128 works with pypdf's pure-Python crypto fallback (no extra package)
    writer.encrypt(user_password=user_password, owner_password=owner_password, algorithm="RC4-128")
    return _save(writer.write)


# ---------------------------------------------------------------------------
# Office documents
# ---------------------------------------------------------------------------


def _build_multi_sheet(wb: openpyxl.Workbook) -> None:
    sales = wb.active
    sales.title = "売上"
    for row in [("商品", "数量"), ("りんご", 3), ("みかん", 5)]:
        sales.append(row)
    summary = wb.create_sheet("Summary <#1>")
    summary.append(("Total", 8))
    wb.create_sheet("Empty")


def _build_single_sheet(wb: openpyxl.Workbook) -> None:
    wb.active.title = "OnlySheet"
    wb.active["A1"] = "single sheet marker"


def _build_hidden_sheet(wb: openpyxl.Workbook) -> None:
    wb.active.title = "Visible"
    wb.active["A1"] = "visible marker"
    secret = wb.create_sheet("Secret")
    secret["A1"] = "hidden marker"
    secret.sheet_state = "hidden"


def _build_chart_sheet(wb: openpyxl.Workbook) -> None:
    data = wb.active
    data.title = "Data"
    for row in [("Month", "Sales"), ("Jan", 10), ("Feb", 20), ("Mar", 30)]:
        data.append(row)
    chart = BarChart()
    chart.add_data(Reference(data, min_col=2, min_row=1, max_row=4), titles_from_data=True)
    chart.set_categories(Reference(data, min_col=1, min_row=2, max_row=4))
    wb.create_chartsheet("Chart").add_chart(chart)


def write_xlsx_cells(dest: Path, sheets: list[tuple[str, int, int]], tail_cells: int = 0) -> None:
    """Write ``(name, rows, cols)`` sheets with a value in every cell (write-only, so it stays fast).

    ``tail_cells`` adds one more row with that many cells to the last sheet.
    """
    wb = openpyxl.Workbook(write_only=True)
    for index, (name, rows, cols) in enumerate(sheets):
        ws = wb.create_sheet(name)
        for r in range(rows):
            ws.append([f"r{r}c{c}" for c in range(cols)])
        if tail_cells and index == len(sheets) - 1:
            ws.append([f"tail{c}" for c in range(tail_cells)])
    wb.save(dest)


def make_docx(first_paragraph: str, images: Iterable[bytes] = ()) -> bytes:
    doc = Document()
    doc.add_paragraph(first_paragraph)
    for image in images:
        doc.add_picture(io.BytesIO(image), width=Inches(1))
    return _save(doc.save)


def make_pptx(titles: list[str], bodies: list[str] | None = None, images: Iterable[bytes] = ()) -> bytes:
    prs = Presentation()
    title_and_content = prs.slide_layouts[1]
    for index, title in enumerate(titles):
        slide = prs.slides.add_slide(title_and_content)
        slide.shapes.title.text = title
        if bodies is not None:
            slide.placeholders[1].text = bodies[index]
    title_only = prs.slide_layouts[5]
    for image in images:
        prs.slides.add_slide(title_only).shapes.add_picture(io.BytesIO(image), PptxInches(1), PptxInches(1))
    return _save(prs.save)


def _deep_document_xml(depth: int) -> bytes:
    opening = b"<w:sdt><w:sdtContent>" * depth
    closing = b"</w:sdtContent></w:sdt>" * depth
    return (
        b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        b'<w:document xmlns:w="'
        + _W_NS.encode()
        + b'"><w:body>'
        + opening
        + b"<w:p><w:r><w:t>deep</w:t></w:r></w:p>"
        + closing
        + b"</w:body></w:document>"
    )


def _bomb_document_xml(target_bytes: int) -> Iterable[bytes]:
    yield b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    yield b'<w:document xmlns:w="' + _W_NS.encode() + b'"><w:body>'
    paragraph = b"<w:p><w:r><w:t>" + b"A" * 4000 + b"</w:t></w:r></w:p>"
    block = paragraph * 256  # ~1 MiB per write keeps memory flat
    written = 0
    while written < target_bytes:
        yield block
        written += len(block)
    yield b"</w:body></w:document>"


# ---------------------------------------------------------------------------
# Text-ish formats
# ---------------------------------------------------------------------------


def _rtf_escape(text: str) -> str:
    def esc(ch: str) -> str:
        code = ord(ch)
        if code < 128:
            return {"\\": "\\\\", "{": "\\{", "}": "\\}", "\n": "\\par\n"}.get(ch, ch)
        return f"\\u{code if code < 32768 else code - 65536}?"

    return "".join(esc(ch) for ch in text)


_ODF_MANIFEST = """<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
 <manifest:file-entry manifest:full-path="/" manifest:media-type="{mimetype}"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
"""

_ODF_CONTENT = """<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
 office:version="1.2">
 <office:body>{body}</office:body>
</office:document-content>
"""


def _odf(kind: str, body: str) -> bytes:
    mimetype = f"application/vnd.oasis.opendocument.{kind}"
    return _zip_package(
        mimetype,
        {
            "content.xml": _ODF_CONTENT.format(body=body),
            "META-INF/manifest.xml": _ODF_MANIFEST.format(mimetype=mimetype),
        },
    )


_ODT_BODY = "<office:text><text:h>見出し</text:h><text:p>OpenDocument text marker</text:p></office:text>"
_ODS_BODY = (
    "<office:spreadsheet>"
    '<table:table table:name="First"><table:table-row><table:table-cell office:value-type="string">'
    "<text:p>OpenDocument sheet marker</text:p></table:table-cell></table:table-row></table:table>"
    '<table:table table:name="Second"><table:table-row><table:table-cell office:value-type="string">'
    "<text:p>second sheet</text:p></table:table-cell></table:table-row></table:table>"
    "</office:spreadsheet>"
)
_ODP_BODY = (
    '<office:presentation><draw:page draw:name="page1"><draw:frame svg:x="1cm" svg:y="1cm" '
    'svg:width="10cm" svg:height="2cm"><draw:text-box><text:p>OpenDocument slide marker</text:p>'
    "</draw:text-box></draw:frame></draw:page></office:presentation>"
)

_EPUB_CONTAINER = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
 <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
"""

_EPUB_OPF = """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
 <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="uid">urn:uuid:00000000-0000-4000-8000-000000000000</dc:identifier>
  <dc:title>Fixture Book</dc:title>
  <dc:language>ja</dc:language>
  <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
 </metadata>
 <manifest>
  <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
 </manifest>
 <spine><itemref idref="ch1"/></spine>
</package>
"""

_EPUB_NAV = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Chapter 1</a></li></ol></nav></body>
</html>
"""

_EPUB_CHAPTER = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body><h1>第一章</h1><p>EPUB chapter marker</p></body>
</html>
"""


# ---------------------------------------------------------------------------
# Fixtures: credentials
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def office_password() -> str:
    return OFFICE_PASSWORD


@pytest.fixture(scope="session")
def pdf_password() -> str:
    return PDF_USER_PASSWORD


# ---------------------------------------------------------------------------
# Fixtures: XLSX
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def xlsx_multi_sheet() -> bytes:
    """Sheets ``売上`` / ``Summary <#1>`` / ``Empty`` (the last has no cells)."""
    return _workbook_bytes(_build_multi_sheet)


@pytest.fixture(scope="session")
def xlsx_single_sheet() -> bytes:
    return _workbook_bytes(_build_single_sheet)


@pytest.fixture(scope="session")
def xlsx_hidden_sheet() -> bytes:
    """``Visible`` plus a hidden ``Secret`` sheet."""
    return _workbook_bytes(_build_hidden_sheet)


@pytest.fixture(scope="session")
def xlsx_chart_sheet() -> bytes:
    """A ``Data`` worksheet followed by a ``Chart`` chartsheet."""
    return _workbook_bytes(_build_chart_sheet)


@pytest.fixture(scope="session")
def xlsx_over_cell_limit_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Exactly ``MAX_XLSX_CELLS + 1`` cells, so only the cell pre-check rejects it."""
    dest = tmp_path_factory.mktemp("xlsx") / "over-cell-limit.xlsx"
    rows, tail = divmod(_MAX_XLSX_CELLS + 1, 10)
    write_xlsx_cells(dest, [("Big", rows, 10)], tail_cells=tail)
    return dest


@pytest.fixture(scope="session")
def xlsx_large_for_timeout_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """5 sheets × 14,000 rows × 1 column = exactly ``MAX_XLSX_CELLS``.

    Kept at the limit (not over) so it passes the cell pre-check and reaches
    anydoc, where a short deadline or a small RSS cap can stop it.
    """
    dest = tmp_path_factory.mktemp("xlsx") / "large-for-timeout.xlsx"
    rows = _MAX_XLSX_CELLS // 5
    write_xlsx_cells(dest, [(f"Sheet{i}", rows, 1) for i in range(1, 6)])
    return dest


# ---------------------------------------------------------------------------
# Fixtures: PPTX / DOCX
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def pptx_multi_slide() -> bytes:
    return make_pptx(
        ["Slide One", "Slide Two", "Slide Three"],
        ["first slide body", "second slide body", "third slide body"],
    )


# 11 × 4 MiB of random pixels: over 40 MiB, under the 50 MB upload limit.
_LARGE_IMAGE_COUNT = 11
_LARGE_IMAGE_SIDE = 2048


@pytest.fixture(scope="session")
def docx_large_images_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    dest = tmp_path_factory.mktemp("large") / "large-images.docx"
    dest.write_bytes(
        make_docx("large docx with images", _random_images(_LARGE_IMAGE_COUNT, _LARGE_IMAGE_SIDE, seed=40))
    )
    return dest


@pytest.fixture(scope="session")
def pptx_large_images_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    dest = tmp_path_factory.mktemp("large") / "large-images.pptx"
    images = _random_images(_LARGE_IMAGE_COUNT, _LARGE_IMAGE_SIDE, seed=41)
    dest.write_bytes(make_pptx(["large pptx with images"], ["slide with images follows"], images))
    return dest


@pytest.fixture(scope="session")
def docx_zip_bomb_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A valid DOCX whose ``word/document.xml`` expands past ``MAX_ARCHIVE_UNCOMPRESSED_MB``."""
    dest = tmp_path_factory.mktemp("bomb") / "zip-bomb.docx"
    target = (_MAX_ARCHIVE_UNCOMPRESSED_MB + 8) * _MIB
    _rewrite_zip_member(make_docx("bomb"), dest, "word/document.xml", _bomb_document_xml(target))
    return dest


@pytest.fixture(scope="session")
def docx_deeply_nested() -> bytes:
    """A valid DOCX whose body nests 100,000 ``w:sdt`` levels."""
    buf = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(make_docx("nested"))) as src,
        zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as out,
    ):
        for info in src.infolist():
            body = _deep_document_xml(100_000) if info.filename == "word/document.xml" else src.read(info.filename)
            out.writestr(info.filename, body)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Fixtures: encrypted OOXML
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def docx_encrypted() -> bytes:
    return _encrypt_ooxml(make_docx(ENCRYPTED_MARKER))


@pytest.fixture(scope="session")
def xlsx_encrypted() -> bytes:
    def build(wb: openpyxl.Workbook) -> None:
        wb.active["A1"] = ENCRYPTED_MARKER

    return _encrypt_ooxml(_workbook_bytes(build))


@pytest.fixture(scope="session")
def pptx_encrypted() -> bytes:
    return _encrypt_ooxml(make_pptx([ENCRYPTED_MARKER]))


# ---------------------------------------------------------------------------
# Fixtures: PDF
# ---------------------------------------------------------------------------

_PDF_PAGE_TEXTS = ["PDF page 1", "PDF page 2", "PDF page 3"]


@pytest.fixture(scope="session")
def pdf_text() -> bytes:
    """Three pages, each containing only ``PDF page N``."""
    return make_text_pdf(_PDF_PAGE_TEXTS)


@pytest.fixture(scope="session")
def pdf_user_password(pdf_text: bytes) -> bytes:
    return _encrypt_pdf(pdf_text, user_password=PDF_USER_PASSWORD, owner_password=PDF_OWNER_PASSWORD)


@pytest.fixture(scope="session")
def pdf_owner_password_only(pdf_text: bytes) -> bytes:
    """Restricts permissions only: opens (and extracts) without any password."""
    return _encrypt_pdf(pdf_text, user_password="", owner_password=PDF_OWNER_PASSWORD)


@pytest.fixture(scope="session")
def pdf_image_only() -> bytes:
    side = 16
    image = _pdf_stream(
        b"/Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8"
        % (side, side),
        bytes((i * 7) % 256 for i in range(side * side)),
    )
    page = (b"<< /XObject << /Im1 4 0 R >> >>", b"q 200 0 0 200 100 400 cm /Im1 Do Q")
    return _build_pdf([page], [image])


@pytest.fixture(scope="session")
def pdf_corrupt(pdf_text: bytes) -> bytes:
    """A PDF header and the start of an object, then garbage: no xref, trailer or root."""
    header_end = pdf_text.index(b"1 0 obj")
    return pdf_text[: header_end + 20] + bytes(random.Random(7).randbytes(512))  # noqa: S311


# ---------------------------------------------------------------------------
# Fixtures: plain text encodings
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def text_shift_jis() -> bytes:
    return JAPANESE_SAMPLE.encode("shift_jis")


@pytest.fixture(scope="session")
def text_euc_jp() -> bytes:
    return JAPANESE_SAMPLE.encode("euc_jp")


@pytest.fixture(scope="session")
def text_utf8_bom() -> bytes:
    return JAPANESE_SAMPLE.encode("utf-8-sig")


# ---------------------------------------------------------------------------
# Fixtures: OpenDocument / EPUB / RTF / XLS
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def odt() -> bytes:
    return _odf("text", _ODT_BODY)


@pytest.fixture(scope="session")
def ods() -> bytes:
    return _odf("spreadsheet", _ODS_BODY)


@pytest.fixture(scope="session")
def odp() -> bytes:
    return _odf("presentation", _ODP_BODY)


@pytest.fixture(scope="session")
def epub() -> bytes:
    return _zip_package(
        "application/epub+zip",
        {
            "META-INF/container.xml": _EPUB_CONTAINER,
            "OEBPS/content.opf": _EPUB_OPF,
            "OEBPS/nav.xhtml": _EPUB_NAV,
            "OEBPS/chapter1.xhtml": _EPUB_CHAPTER,
        },
    )


@pytest.fixture(scope="session")
def rtf() -> bytes:
    body = _rtf_escape("RTF body marker\n" + JAPANESE_SAMPLE)
    return ("{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\uc1\\f0 " + body + "\\par\n}").encode("ascii")


@pytest.fixture(scope="session")
def xls() -> bytes:
    wb = xlwt.Workbook()
    first = wb.add_sheet("First")
    first.write(0, 0, "XLS cell marker")
    first.write(0, 1, 42)
    wb.add_sheet("Second").write(0, 0, "second sheet")
    return _save(wb.save)


# ---------------------------------------------------------------------------
# Fixtures: vendored legacy DOC / PPT
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def legacy_doc() -> Path:
    return LEGACY_DIR / "simple-table.doc"


@pytest.fixture(scope="session")
def legacy_ppt() -> Path:
    return LEGACY_DIR / "text_shapes.ppt"


@pytest.fixture(scope="session")
def legacy_fixture_sha256() -> dict[str, str]:
    """File name → SHA-256 as recorded in ``tests/fixtures/legacy/README.md``."""
    readme = (LEGACY_DIR / "README.md").read_text(encoding="utf-8")
    return dict(re.findall(r"^\| `([^`]+)` \|.*\| `([0-9a-f]{64})` \|$", readme, flags=re.MULTILINE))
