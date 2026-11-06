"""ConversionCore entry point: routing, normalization, empty-element rule, failures (Req 1.1-1.12, 2.6)."""

import re
from pathlib import Path

import pytest

from app import conversion
from app.conversion import core
from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits
from app.conversion.results import ConversionSuccess
from app.schemas import PageInfo
from fixture_files import ENCRYPTED_MARKER, JAPANESE_SAMPLE, make_docx

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _limits(max_result_bytes: int = 1_000_000) -> ConversionLimits:
    return ConversionLimits(
        max_child_rss_mb=512,
        max_result_bytes=max_result_bytes,
        max_pdf_pages=100,
        max_archive_entries=10_000,
        max_archive_uncompressed_mb=512,
        max_xlsx_cells=70_000,
        ipynb_output_max_chars=10_000,
        max_csv_bytes=8 * 1024 * 1024,
        max_html_bytes=20 * 1024 * 1024,
    )


def _convert(data: bytes, filename: str, mime_hint: str | None = None, limits: ConversionLimits | None = None):
    return conversion.convert(data, filename, mime_hint, limits or _limits())


def _failure(data: bytes, filename: str, mime_hint: str | None = None, limits: ConversionLimits | None = None):
    with pytest.raises(ConversionError) as excinfo:
        _convert(data, filename, mime_hint, limits)
    return excinfo.value


def _joined(result: ConversionSuccess) -> str:
    return "\n".join(page.content for page in result.pages)


# ---------------------------------------------------------------------------
# Units, numbers and labels per route
# ---------------------------------------------------------------------------


def test_pdf_returns_one_element_per_page_with_number_and_label(pdf_text: bytes) -> None:
    result = _convert(pdf_text, "a.pdf")
    assert result.mime_type == "application/pdf"
    assert [(p.pageNumber, p.label) for p in result.pages] == [(1, "1"), (2, "2"), (3, "3")]
    assert "PDF page 2" in result.pages[1].content


def test_image_only_pdf_yields_one_empty_element(pdf_image_only: bytes) -> None:
    assert _convert(pdf_image_only, "scan.pdf").pages == [PageInfo(pageNumber=None, label=None, content="")]


def test_pptx_returns_one_element_per_slide(pptx_multi_slide: bytes) -> None:
    result = _convert(pptx_multi_slide, "deck.pptx")
    assert result.mime_type == PPTX_MIME
    assert len(result.pages) > 1
    assert [p.pageNumber for p in result.pages] == list(range(1, len(result.pages) + 1))
    assert [p.label for p in result.pages] == [str(p.pageNumber) for p in result.pages]


def test_xlsx_returns_one_element_per_nonempty_sheet_keeping_original_numbers(xlsx_multi_sheet: bytes) -> None:
    result = _convert(xlsx_multi_sheet, "book.xlsx")
    assert result.mime_type == XLSX_MIME
    # The third sheet ("Empty") is dropped; numbering of the others is untouched.
    assert [(p.pageNumber, p.label) for p in result.pages] == [(1, "売上"), (2, "Summary <#1>")]


def test_docx_returns_one_element_without_page_number() -> None:
    result = _convert(make_docx("本文"), "a.docx")
    assert result.mime_type == DOCX_MIME
    assert [(p.pageNumber, p.label) for p in result.pages] == [(None, None)]
    assert "本文" in result.pages[0].content


@pytest.mark.parametrize(
    ("fixture", "filename", "marker"),
    [
        ("rtf", "a.rtf", "RTF body marker"),
        ("epub", "a.epub", "EPUB"),
        ("odt", "a.odt", "OpenDocument text marker"),
        ("ods", "a.ods", ""),
        ("odp", "a.odp", ""),
        ("xls", "a.xls", "XLS cell marker"),
    ],
)
def test_single_element_office_formats(
    request: pytest.FixtureRequest, fixture: str, filename: str, marker: str
) -> None:
    result = _convert(request.getfixturevalue(fixture), filename)
    assert len(result.pages) == 1
    assert (result.pages[0].pageNumber, result.pages[0].label) == (None, None)
    assert marker in result.pages[0].content
    assert result.pages[0].content != ""


@pytest.mark.parametrize(("fixture", "filename"), [("legacy_doc", "a.doc"), ("legacy_ppt", "a.ppt")])
def test_legacy_binary_office_formats_return_one_element(
    request: pytest.FixtureRequest, fixture: str, filename: str
) -> None:
    path: Path = request.getfixturevalue(fixture)
    result = _convert(path.read_bytes(), filename)
    assert len(result.pages) == 1
    assert (result.pages[0].pageNumber, result.pages[0].label) == (None, None)
    assert result.pages[0].content.strip() != ""


@pytest.mark.parametrize(
    ("filename", "data", "expected_mime", "marker"),
    [
        ("a.html", b"<html><body><p>html marker</p></body></html>", "text/html", "html marker"),
        ("a.xml", b"<?xml version='1.0'?><r><i>xml marker</i></r>", "text/xml", "xml marker"),
        (
            "a.ipynb",
            b'{"cells":[{"cell_type":"markdown","source":["ipynb marker"]}],"nbformat":4,"nbformat_minor":5}',
            "application/x-ipynb+json",
            "ipynb marker",
        ),
        ("a.txt", b"txt marker", "text/plain", "txt marker"),
        ("a.csv", b"h1,h2\ncsv marker,2\n", "text/csv", "csv marker"),
        ("a.tsv", b"h1\th2\ntsv marker\t2\n", "text/tab-separated-values", "tsv marker"),
        ("a.md", b"# md marker\n", "text/markdown", "md marker"),
        ("a.json", b'{"k": "json marker"}', "application/json", "json marker"),
        ("a.yaml", b"k: yaml marker\n", "text/yaml", "yaml marker"),
    ],
)
def test_text_formats_return_one_element_without_page_number(
    filename: str, data: bytes, expected_mime: str, marker: str
) -> None:
    result = _convert(data, filename)
    assert result.mime_type == expected_mime
    assert [(p.pageNumber, p.label) for p in result.pages] == [(None, None)]
    assert marker in result.pages[0].content


def test_mime_hint_wins_over_extension() -> None:
    result = _convert(b"plain words", "noext.bin", "text/plain; charset=utf-8")
    assert result.mime_type == "text/plain"
    assert "plain words" in result.pages[0].content


# ---------------------------------------------------------------------------
# Normalization: newlines unified everywhere, no Japanese gap closing outside PDF
# ---------------------------------------------------------------------------


def test_plain_text_keeps_japanese_line_break_and_unifies_newlines() -> None:
    result = _convert("障害対応メモ\r\n本番環境で発生\r別行".encode(), "memo.txt")
    assert result.pages[0].content == "障害対応メモ\n本番環境で発生\n別行"


def test_txt_sample_is_kept_as_is() -> None:
    result = _convert(JAPANESE_SAMPLE.encode(), "memo.txt")
    assert result.pages[0].content.startswith("障害対応メモ\n本番環境で発生")


def test_docx_paragraph_break_between_japanese_text_is_kept() -> None:
    result = _convert(make_docx(JAPANESE_SAMPLE), "memo.docx")
    content = result.pages[0].content
    assert "障害対応メモ本番環境" not in content
    assert re.search(r"障害対応メモ\\?\n+本番環境で発生", content)


def test_newlines_are_unified_in_every_element(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        core,
        "convert_pptx",
        lambda data, limits: [PageInfo(pageNumber=1, label="1", content="a\r\nb\rc")],
    )
    result = _convert(b"unused", "x.pptx")
    assert result.pages == [PageInfo(pageNumber=1, label="1", content="a\nb\nc")]


# ---------------------------------------------------------------------------
# Empty-element rule
# ---------------------------------------------------------------------------


def test_empty_elements_are_dropped_and_original_numbers_are_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    pages = [
        PageInfo(pageNumber=1, label="1", content="first"),
        PageInfo(pageNumber=2, label="2", content=""),
        PageInfo(pageNumber=3, label="3", content="\r\n"),
        PageInfo(pageNumber=4, label="4", content="fourth"),
    ]
    monkeypatch.setattr(core, "convert_pdf", lambda data, limits: pages)
    result = _convert(b"unused", "x.pdf")
    # "\r\n" is a newline only, not empty: only truly empty content is dropped.
    assert [p.pageNumber for p in result.pages] == [1, 3, 4]


@pytest.mark.parametrize("converter", ["convert_pptx", "convert_xlsx"])
def test_empty_list_becomes_one_empty_element(monkeypatch: pytest.MonkeyPatch, converter: str) -> None:
    monkeypatch.setattr(core, converter, lambda data, limits: [])
    filename = "x.pptx" if converter == "convert_pptx" else "x.xlsx"
    assert _convert(b"unused", filename).pages == [PageInfo(pageNumber=None, label=None, content="")]


def test_fallback_element_with_null_number_passes_through(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        core, "convert_xlsx", lambda data, limits: [PageInfo(pageNumber=None, label=None, content="whole book")]
    )
    assert _convert(b"unused", "x.xlsx").pages == [PageInfo(pageNumber=None, label=None, content="whole book")]


def test_empty_text_file_yields_one_empty_element() -> None:
    assert _convert(b"", "empty.txt").pages == [PageInfo(pageNumber=None, label=None, content="")]


# ---------------------------------------------------------------------------
# Failure classification
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("filename", "mime"),
    [("mail.msg", "application/vnd.ms-outlook"), ("mail.msg", None), ("noextension", None), ("a.exe", None)],
)
def test_unsupported_formats(filename: str, mime: str | None) -> None:
    assert _failure(b"data", filename, mime).kind == "unsupported"


def test_encrypted_docx_is_classified(docx_encrypted: bytes) -> None:
    assert _failure(docx_encrypted, "a.docx").kind == "encrypted"


def test_user_password_pdf_is_classified(pdf_user_password: bytes) -> None:
    assert _failure(pdf_user_password, "a.pdf").kind == "encrypted"


def test_owner_password_only_pdf_is_extracted(pdf_owner_password_only: bytes) -> None:
    assert "PDF page 1" in _joined(_convert(pdf_owner_password_only, "a.pdf"))


def test_corrupt_pdf_is_malformed(pdf_corrupt: bytes) -> None:
    assert _failure(pdf_corrupt, "a.pdf").kind == "malformed"


def test_corrupt_docx_is_malformed() -> None:
    assert _failure(b"not a zip at all", "a.docx").kind == "malformed"


def test_pdf_page_limit_is_limit_exceeded(pdf_text: bytes) -> None:
    limits = ConversionLimits(**{**_limits().__dict__, "max_pdf_pages": 2})
    assert _failure(pdf_text, "a.pdf", limits=limits).kind == "limit_exceeded"


def test_oversized_result_is_result_too_large() -> None:
    failure = _failure(b"x" * 101, "a.txt", limits=_limits(max_result_bytes=100))
    assert failure.kind == "result_too_large"


def test_result_at_exactly_the_limit_passes() -> None:
    assert _convert(b"x" * 100, "a.txt", limits=_limits(max_result_bytes=100)).pages[0].content == "x" * 100


def test_result_limit_counts_utf8_bytes_not_characters() -> None:
    # 40 characters, 120 UTF-8 bytes.
    assert _failure(("あ" * 40).encode(), "a.txt", limits=_limits(max_result_bytes=100)).kind == "result_too_large"


def test_result_limit_is_summed_across_elements_after_dropping_empties(monkeypatch: pytest.MonkeyPatch) -> None:
    pages = [PageInfo(pageNumber=n, label=str(n), content="x" * 60) for n in (1, 2)]
    monkeypatch.setattr(core, "convert_pdf", lambda data, limits: pages)
    assert _failure(b"unused", "a.pdf", limits=_limits(max_result_bytes=100)).kind == "result_too_large"


def test_result_limit_ignores_dropped_empty_elements_and_normalized_newlines(monkeypatch: pytest.MonkeyPatch) -> None:
    pages = [
        PageInfo(pageNumber=1, label="1", content="a\r\nb"),
        PageInfo(pageNumber=2, label="2", content=""),
    ]
    monkeypatch.setattr(core, "convert_pdf", lambda data, limits: pages)
    # "a\nb" is 3 bytes after normalization; "a\r\nb" would be 4.
    assert len(_convert(b"unused", "a.pdf", limits=_limits(max_result_bytes=3)).pages) == 1


@pytest.mark.parametrize("exc", [MemoryError("SECRET-BODY"), RecursionError("SECRET-BODY"), ValueError("SECRET-BODY")])
def test_unexpected_exception_is_internal_without_leaking_message(
    monkeypatch: pytest.MonkeyPatch, exc: Exception
) -> None:
    def boom(data: bytes, limits: ConversionLimits) -> list[PageInfo]:
        raise exc

    monkeypatch.setattr(core, "convert_pdf", boom)
    failure = _failure(b"unused", "a.pdf")
    assert failure.kind == "internal"
    assert failure.detail == type(exc).__name__
    assert "SECRET-BODY" not in str(failure)


@pytest.mark.parametrize("exc", [SystemExit(1), KeyboardInterrupt()])
def test_process_control_exceptions_propagate(monkeypatch: pytest.MonkeyPatch, exc: BaseException) -> None:
    def stop(data: bytes, limits: ConversionLimits) -> list[PageInfo]:
        raise exc

    monkeypatch.setattr(core, "convert_pdf", stop)
    with pytest.raises(type(exc)):
        _convert(b"unused", "a.pdf")


def test_converter_conversion_error_keeps_kind_and_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(data: bytes, limits: ConversionLimits) -> list[PageInfo]:
        raise ConversionError("limit_exceeded", "too many cells")

    monkeypatch.setattr(core, "convert_xlsx", fail)
    failure = _failure(b"unused", "a.xlsx")
    assert (failure.kind, failure.detail) == ("limit_exceeded", "too many cells")


def test_encrypted_marker_is_not_in_encrypted_failure(docx_encrypted: bytes) -> None:
    assert ENCRYPTED_MARKER not in str(_failure(docx_encrypted, "a.docx"))
