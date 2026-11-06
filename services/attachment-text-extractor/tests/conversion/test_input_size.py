"""Input size caps decided before conversion: CSV / TSV and HTML only (Req 2.6)."""

from __future__ import annotations

import dataclasses

import pytest

from app.conversion import convert
from app.conversion.errors import ConversionError
from app.conversion.formats import resolve_format
from app.conversion.limits import ConversionLimits, check_input_size

CSV_CAP = 100
HTML_CAP = 200


def _limits() -> ConversionLimits:
    return ConversionLimits(
        max_child_rss_mb=512,
        max_result_bytes=1_000_000,
        max_pdf_pages=100,
        max_archive_entries=10_000,
        max_archive_uncompressed_mb=512,
        max_xlsx_cells=70_000,
        ipynb_output_max_chars=10_000,
        max_csv_bytes=CSV_CAP,
        max_html_bytes=HTML_CAP,
    )


def _check(filename: str, size: int, mime_hint: str | None = None) -> None:
    check_input_size(resolve_format(filename, mime_hint), size, _limits())


CAPPED = [
    ("a.csv", None, CSV_CAP),
    ("a.tsv", None, CSV_CAP),
    ("a.html", None, HTML_CAP),
    ("a.htm", None, HTML_CAP),
    ("noext", "text/csv", CSV_CAP),
    ("noext", "text/tab-separated-values", CSV_CAP),
    ("noext", "text/html; charset=utf-8", HTML_CAP),
]


@pytest.mark.parametrize(("filename", "mime", "cap"), CAPPED)
def test_size_at_the_cap_passes(filename: str, mime: str | None, cap: int) -> None:
    _check(filename, cap, mime)


@pytest.mark.parametrize(("filename", "mime", "cap"), CAPPED)
def test_one_byte_over_the_cap_is_limit_exceeded(filename: str, mime: str | None, cap: int) -> None:
    with pytest.raises(ConversionError) as excinfo:
        _check(filename, cap + 1, mime)
    assert excinfo.value.kind == "limit_exceeded"


@pytest.mark.parametrize(
    "filename",
    ["a.xml", "a.ipynb", "a.txt", "a.md", "a.json", "a.yaml", "a.pdf", "a.docx", "a.xlsx", "a.pptx", "a.xls"],
)
def test_other_formats_have_no_input_size_cap(filename: str) -> None:
    _check(filename, 10**12)


def test_mime_hint_beats_the_extension() -> None:
    # The hint decides the format, so it also decides which cap applies.
    with pytest.raises(ConversionError):
        _check("a.txt", CSV_CAP + 1, "text/csv")
    _check("a.csv", CSV_CAP + 1, "text/plain")


def test_the_detail_never_carries_the_size_or_the_name() -> None:
    with pytest.raises(ConversionError) as excinfo:
        _check("SECRET-NAME.csv", CSV_CAP + 1)
    assert "SECRET-NAME" not in excinfo.value.detail
    assert str(CSV_CAP + 1) not in excinfo.value.detail


class TestConvertEnforcesTheCapItself:
    """The conversion layer stays correct when called without the parent's pre-check."""

    def test_csv_over_the_cap_is_limit_exceeded(self) -> None:
        with pytest.raises(ConversionError) as excinfo:
            convert(b"a,b\n" * 26, "a.csv", None, _limits())  # 104 bytes
        assert excinfo.value.kind == "limit_exceeded"

    def test_csv_at_the_cap_is_converted(self) -> None:
        result = convert(b"a,b\n" * 25, "a.csv", None, _limits())  # 100 bytes
        assert "a" in result.pages[0].content

    def test_html_over_the_cap_is_limit_exceeded(self) -> None:
        with pytest.raises(ConversionError) as excinfo:
            convert(b"<p>x</p>" * 26, "a.html", None, _limits())  # 208 bytes
        assert excinfo.value.kind == "limit_exceeded"

    def test_html_at_the_cap_is_converted(self) -> None:
        result = convert(b"<p>x</p>" * 25, "a.html", None, _limits())  # 200 bytes
        assert result.pages[0].content.startswith("x")

    def test_text_over_the_csv_cap_is_not_affected(self) -> None:
        limits = dataclasses.replace(_limits(), max_csv_bytes=1, max_html_bytes=1)
        assert convert(b"plain text", "a.txt", None, limits).pages[0].content == "plain text"
