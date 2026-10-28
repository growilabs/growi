"""Acquisition checks for the generated / vendored document fixtures.

These tests only prove that each fixture is the kind of file its name claims
(valid container, expected sheets / slides / cell count / encryption status).
How the service converts them is covered by the conversion and runner tests.
"""

from __future__ import annotations

import hashlib
import io
import re
import zipfile
from pathlib import Path

import msoffcrypto
import openpyxl
import pypdfium2
import pytest
from docx import Document
from pptx import Presentation
from pypdf import PdfReader

from app.config import Settings
from fixture_files import ENCRYPTED_MARKER, JAPANESE_SAMPLE

OLE2_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
MIB = 1024 * 1024
CELL_TAG = re.compile(rb"<c[\s>/]")


def _default(name: str) -> int:
    return Settings.model_fields[name].default


def _xlsx_cells_per_sheet(path_or_bytes: Path | bytes) -> list[int]:
    src = io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, bytes) else path_or_bytes
    with zipfile.ZipFile(src) as zf:
        sheets = sorted(
            (n for n in zf.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)),
            key=lambda n: int(re.search(r"\d+", n).group()),
        )
        return [len(CELL_TAG.findall(zf.read(name))) for name in sheets]


def _load_xlsx(data: bytes) -> openpyxl.Workbook:
    return openpyxl.load_workbook(io.BytesIO(data))


# ---------------------------------------------------------------------------
# XLSX
# ---------------------------------------------------------------------------


def test_xlsx_multi_sheet_has_named_sheets_including_an_empty_one(xlsx_multi_sheet: bytes) -> None:
    wb = _load_xlsx(xlsx_multi_sheet)
    assert wb.sheetnames == ["売上", "Summary <#1>", "Empty"]
    assert wb["売上"]["A1"].value == "商品"
    assert wb["Summary <#1>"]["A1"].value == "Total"
    empty = wb["Empty"]
    assert empty.max_row == 1 and empty["A1"].value is None


def test_xlsx_single_sheet_has_one_sheet(xlsx_single_sheet: bytes) -> None:
    wb = _load_xlsx(xlsx_single_sheet)
    assert wb.sheetnames == ["OnlySheet"]
    assert wb["OnlySheet"]["A1"].value == "single sheet marker"


def test_xlsx_hidden_sheet_has_one_visible_and_one_hidden(xlsx_hidden_sheet: bytes) -> None:
    wb = _load_xlsx(xlsx_hidden_sheet)
    assert [(ws.title, ws.sheet_state) for ws in wb.worksheets] == [
        ("Visible", "visible"),
        ("Secret", "hidden"),
    ]


def test_xlsx_chart_sheet_has_data_sheet_and_chartsheet(xlsx_chart_sheet: bytes) -> None:
    wb = _load_xlsx(xlsx_chart_sheet)
    assert wb.sheetnames == ["Data", "Chart"]
    assert [cs.title for cs in wb.chartsheets] == ["Chart"]
    with zipfile.ZipFile(io.BytesIO(xlsx_chart_sheet)) as zf:
        assert any(n.startswith("xl/chartsheets/") for n in zf.namelist())
        assert any(n.startswith("xl/charts/chart") for n in zf.namelist())


def test_xlsx_over_cell_limit_exceeds_max_xlsx_cells_by_one(xlsx_over_cell_limit_path: Path) -> None:
    assert sum(_xlsx_cells_per_sheet(xlsx_over_cell_limit_path)) == _default("MAX_XLSX_CELLS") + 1


def test_xlsx_large_for_timeout_is_five_sheets_within_the_cell_limit(xlsx_large_for_timeout_path: Path) -> None:
    # Must stay at or under the limit so it reaches anydoc instead of the cell pre-check
    per_sheet = _xlsx_cells_per_sheet(xlsx_large_for_timeout_path)
    assert per_sheet == [14_000] * 5
    assert sum(per_sheet) == _default("MAX_XLSX_CELLS")
    wb = openpyxl.load_workbook(xlsx_large_for_timeout_path, read_only=True)
    try:
        assert wb.sheetnames == [f"Sheet{i}" for i in range(1, 6)]
    finally:
        wb.close()


# ---------------------------------------------------------------------------
# PPTX / DOCX
# ---------------------------------------------------------------------------


def test_pptx_multi_slide_has_three_titled_slides(pptx_multi_slide: bytes) -> None:
    prs = Presentation(io.BytesIO(pptx_multi_slide))
    titles = [slide.shapes.title.text for slide in prs.slides]
    assert titles == ["Slide One", "Slide Two", "Slide Three"]


@pytest.mark.parametrize("fixture_name", ["docx_large_images_path", "pptx_large_images_path"])
def test_large_image_documents_are_between_40mib_and_the_upload_limit(
    fixture_name: str, request: pytest.FixtureRequest
) -> None:
    path: Path = request.getfixturevalue(fixture_name)
    size = path.stat().st_size
    assert 40 * MIB <= size < _default("MAX_FILE_SIZE_MB") * MIB
    with zipfile.ZipFile(path) as zf:
        media = [i for i in zf.infolist() if "/media/" in i.filename]
        assert len(media) >= 5
        # Random pixels: the package must not shrink when compressed
        assert sum(i.compress_size for i in media) >= 40 * MIB
    if fixture_name.startswith("docx"):
        assert Document(str(path)).paragraphs[0].text == "large docx with images"
    else:
        assert Presentation(str(path)).slides[0].shapes.title.text == "large pptx with images"


def test_docx_zip_bomb_is_small_but_expands_past_the_archive_limit(docx_zip_bomb_path: Path) -> None:
    assert docx_zip_bomb_path.stat().st_size < 5 * MIB
    with zipfile.ZipFile(docx_zip_bomb_path) as zf:
        assert "[Content_Types].xml" in zf.namelist()
        declared = sum(i.file_size for i in zf.infolist())
        assert declared > _default("MAX_ARCHIVE_UNCOMPRESSED_MB") * MIB
        assert zf.getinfo("word/document.xml").file_size > _default("MAX_ARCHIVE_UNCOMPRESSED_MB") * MIB


def test_docx_deeply_nested_has_100k_levels(docx_deeply_nested: bytes) -> None:
    with zipfile.ZipFile(io.BytesIO(docx_deeply_nested)) as zf:
        assert "word/styles.xml" in zf.namelist()
        xml = zf.read("word/document.xml")
    # Count by string: parsing a 100k-deep tree is exactly what the fixture is meant to stress
    assert xml.count(b"<w:sdtContent>") >= 100_000
    assert xml.count(b"<w:sdtContent>") == xml.count(b"</w:sdtContent>")
    assert len(docx_deeply_nested) < 1 * MIB


# ---------------------------------------------------------------------------
# Encrypted OOXML
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fixture_name", "reopen"),
    [
        ("docx_encrypted", lambda b: Document(io.BytesIO(b)).paragraphs[0].text),
        ("xlsx_encrypted", lambda b: _load_xlsx(b).active["A1"].value),
        ("pptx_encrypted", lambda b: Presentation(io.BytesIO(b)).slides[0].shapes.title.text),
    ],
)
def test_encrypted_ooxml_is_ole_wrapped_and_decrypts_with_the_password(
    fixture_name: str, reopen, request: pytest.FixtureRequest, office_password: str
) -> None:
    data: bytes = request.getfixturevalue(fixture_name)
    assert data[:8] == OLE2_MAGIC
    office = msoffcrypto.OfficeFile(io.BytesIO(data))
    assert office.is_encrypted()
    office.load_key(password=office_password)
    out = io.BytesIO()
    office.decrypt(out)
    assert zipfile.is_zipfile(out)
    assert reopen(out.getvalue()) == ENCRYPTED_MARKER


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------


def _pdfium_texts(pdf: pypdfium2.PdfDocument) -> list[str]:
    return [pdf[i].get_textpage().get_text_range() for i in range(len(pdf))]


def test_pdf_text_has_one_marker_per_page(pdf_text: bytes) -> None:
    pdf = pypdfium2.PdfDocument(pdf_text)
    assert [t.strip() for t in _pdfium_texts(pdf)] == ["PDF page 1", "PDF page 2", "PDF page 3"]


def test_pdf_user_password_cannot_open_without_password(pdf_user_password: bytes, pdf_password: str) -> None:
    assert PdfReader(io.BytesIO(pdf_user_password)).is_encrypted
    with pytest.raises(pypdfium2.PdfiumError):
        pypdfium2.PdfDocument(pdf_user_password)
    pdf = pypdfium2.PdfDocument(pdf_user_password, password=pdf_password)
    assert _pdfium_texts(pdf)[0].strip() == "PDF page 1"


def test_pdf_owner_password_only_opens_without_password(pdf_owner_password_only: bytes) -> None:
    assert PdfReader(io.BytesIO(pdf_owner_password_only)).is_encrypted
    pdf = pypdfium2.PdfDocument(pdf_owner_password_only)
    assert [t.strip() for t in _pdfium_texts(pdf)] == ["PDF page 1", "PDF page 2", "PDF page 3"]


def test_pdf_image_only_has_an_image_and_no_text(pdf_image_only: bytes) -> None:
    pdf = pypdfium2.PdfDocument(pdf_image_only)
    assert len(pdf) == 1
    assert _pdfium_texts(pdf) == [""]
    kinds = [obj.type for obj in pdf[0].get_objects()]
    assert pypdfium2.raw.FPDF_PAGEOBJ_IMAGE in kinds


def test_pdf_corrupt_has_pdf_header_but_does_not_open(pdf_corrupt: bytes) -> None:
    assert pdf_corrupt.startswith(b"%PDF-")
    with pytest.raises(pypdfium2.PdfiumError):
        pypdfium2.PdfDocument(pdf_corrupt)


# ---------------------------------------------------------------------------
# Text encodings
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fixture_name", "codec"),
    [("text_shift_jis", "shift_jis"), ("text_euc_jp", "euc_jp")],
)
def test_japanese_legacy_encodings_decode_only_with_their_codec(
    fixture_name: str, codec: str, request: pytest.FixtureRequest
) -> None:
    data: bytes = request.getfixturevalue(fixture_name)
    assert data.decode(codec) == JAPANESE_SAMPLE
    with pytest.raises(UnicodeDecodeError):
        data.decode("utf-8")


def test_text_utf8_bom_starts_with_bom(text_utf8_bom: bytes) -> None:
    assert text_utf8_bom.startswith(b"\xef\xbb\xbf")
    assert text_utf8_bom.decode("utf-8-sig") == JAPANESE_SAMPLE


# ---------------------------------------------------------------------------
# OpenDocument / EPUB / RTF / XLS
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fixture_name", "mimetype", "marker"),
    [
        ("odt", b"application/vnd.oasis.opendocument.text", "OpenDocument text marker"),
        ("ods", b"application/vnd.oasis.opendocument.spreadsheet", "OpenDocument sheet marker"),
        ("odp", b"application/vnd.oasis.opendocument.presentation", "OpenDocument slide marker"),
        ("epub", b"application/epub+zip", "EPUB chapter marker"),
    ],
)
def test_zip_based_documents_start_with_a_stored_mimetype(
    fixture_name: str, mimetype: bytes, marker: str, request: pytest.FixtureRequest
) -> None:
    data: bytes = request.getfixturevalue(fixture_name)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        first = zf.infolist()[0]
        assert first.filename == "mimetype"
        assert first.compress_type == zipfile.ZIP_STORED
        assert zf.read("mimetype") == mimetype
        assert "META-INF/manifest.xml" in zf.namelist() or "META-INF/container.xml" in zf.namelist()
        body = b"".join(zf.read(n) for n in zf.namelist() if n.endswith((".xml", ".xhtml")))
    assert marker.encode() in body


def test_rtf_has_header_balanced_braces_and_japanese_unicode_escapes(rtf: bytes) -> None:
    text = rtf.decode("ascii")
    assert text.startswith("{\\rtf1")
    assert text.count("{") == text.count("}")
    assert "RTF body marker" in text
    # 情 = U+60C5 = 24773
    assert "\\u24773?" in text


def test_xls_is_an_ole_biff8_workbook_with_two_sheets(xls: bytes) -> None:
    # msoffcrypto cannot walk xlwt's BIFF stream, so check the OLE / BIFF8 markers directly
    assert xls[:8] == OLE2_MAGIC
    assert "Workbook".encode("utf-16-le") in xls
    # BOF record (0x0809, length 16) declaring BIFF8 (0x0600) for the workbook globals
    assert bytes.fromhex("0908100000060500") in xls
    for marker in (b"First", b"Second", b"XLS cell marker"):
        assert marker in xls


# ---------------------------------------------------------------------------
# Vendored legacy DOC / PPT (Apache POI test data)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fixture_name", "ole_class"),
    [("legacy_doc", "Doc97File"), ("legacy_ppt", "Ppt97File")],
)
def test_legacy_binaries_are_small_unencrypted_ole_files_matching_the_notice(
    fixture_name: str, ole_class: str, request: pytest.FixtureRequest, legacy_fixture_sha256: dict[str, str]
) -> None:
    path: Path = request.getfixturevalue(fixture_name)
    data = path.read_bytes()
    assert data[:8] == OLE2_MAGIC
    assert len(data) < 100 * 1024
    office = msoffcrypto.OfficeFile(io.BytesIO(data))
    assert type(office).__name__ == ole_class
    assert not office.is_encrypted()
    assert hashlib.sha256(data).hexdigest() == legacy_fixture_sha256[path.name]
