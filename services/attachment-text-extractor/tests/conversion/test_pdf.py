"""PdfConverter contract tests against the pinned pypdfium2 (Req 1.4, 1.9, 1.10, 1.11, 1.12, 2.6)."""

import traceback

import pytest

from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits
from app.conversion.pdf import convert_pdf
from fixture_files import PDF_USER_PASSWORD, _build_pdf, _pdf_stream, make_text_pdf


def _limits(max_pdf_pages: int = 100) -> ConversionLimits:
    return ConversionLimits(
        max_child_rss_mb=512,
        max_result_bytes=10_000_000,
        max_pdf_pages=max_pdf_pages,
        max_archive_entries=1000,
        max_archive_uncompressed_mb=100,
        max_xlsx_cells=1_000_000,
        ipynb_output_max_chars=10_000,
    )


def _failure(data: bytes, limits: ConversionLimits | None = None) -> ConversionError:
    with pytest.raises(ConversionError) as excinfo:
        convert_pdf(data, limits or _limits())
    return excinfo.value


def _japanese_lines_pdf(lines: list[str]) -> bytes:
    """One page whose lines are drawn far apart, so PDFium separates them with a line break.

    Text is shown through a Type0 font with a ToUnicode CMap, so no CJK font needs embedding.
    """
    codes = {ch: i + 1 for i, ch in enumerate(dict.fromkeys("".join(lines)))}
    bfchar = "".join(f"<{code:04X}> <{ord(ch):04X}>\n" for ch, code in codes.items()).encode()
    cmap = (
        b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
        b"/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n"
        b"1 begincodespacerange <0000> <FFFF> endcodespacerange\n"
        + b"%d beginbfchar\n" % len(codes)
        + bfchar
        + b"endbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end"
    )
    extras = [
        b"<< /Type /Font /Subtype /Type0 /BaseFont /TestFont /Encoding /Identity-H"
        b" /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>",
        b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestFont"
        b" /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>",
        _pdf_stream(b"", cmap),
    ]
    shown = b"".join(
        b"1 0 0 1 72 %d Tm <" % (700 - 100 * i) + "".join(f"{codes[c]:04X}" for c in line).encode() + b"> Tj\n"
        for i, line in enumerate(lines)
    )
    return _build_pdf([(b"<< /Font << /F1 4 0 R >> >>", b"BT /F1 24 Tf\n" + shown + b"ET")], extras)


def test_returns_one_element_per_page_with_one_based_number_and_label(pdf_text: bytes) -> None:
    pages = convert_pdf(pdf_text, _limits())

    assert [(p.pageNumber, p.label) for p in pages] == [(1, "1"), (2, "2"), (3, "3")]
    for number, page in enumerate(pages, start=1):
        assert f"PDF page {number}" in page.content


def test_content_is_free_of_carriage_returns(pdf_text: bytes) -> None:
    assert all("\r" not in p.content for p in convert_pdf(pdf_text, _limits()))


def test_page_count_equal_to_the_limit_is_accepted(pdf_text: bytes) -> None:
    assert len(convert_pdf(pdf_text, _limits(max_pdf_pages=3))) == 3


def test_page_count_over_the_limit_is_limit_exceeded(pdf_text: bytes) -> None:
    failure = _failure(pdf_text, _limits(max_pdf_pages=2))

    assert failure.kind == "limit_exceeded"


def test_password_protected_pdf_is_encrypted(pdf_user_password: bytes) -> None:
    failure = _failure(pdf_user_password)

    assert failure.kind == "encrypted"
    assert PDF_USER_PASSWORD not in failure.detail


def test_owner_password_only_pdf_is_extracted(pdf_owner_password_only: bytes) -> None:
    pages = convert_pdf(pdf_owner_password_only, _limits())

    assert [p.pageNumber for p in pages] == [1, 2, 3]
    assert "PDF page 2" in pages[1].content


def test_image_only_pdf_keeps_its_page_with_empty_text(pdf_image_only: bytes) -> None:
    pages = convert_pdf(pdf_image_only, _limits())

    assert [(p.pageNumber, p.label, p.content.strip()) for p in pages] == [(1, "1", "")]


def test_corrupt_pdf_is_malformed(pdf_corrupt: bytes) -> None:
    assert _failure(pdf_corrupt).kind == "malformed"


@pytest.mark.parametrize("data", [b"", b"not a pdf at all"])
def test_non_pdf_bytes_are_malformed(data: bytes) -> None:
    assert _failure(data).kind == "malformed"


def test_failure_never_echoes_file_content_in_what_would_be_logged() -> None:
    secret = "TOPSECRET-BODY"
    failure = _failure(b"%PDF-1.4\n" + secret.encode() + b"\n garbage")

    assert secret not in "".join(traceback.format_exception(failure))


def test_japanese_gap_between_lines_is_closed() -> None:
    pages = convert_pdf(_japanese_lines_pdf(["日本", "語です"]), _limits())

    assert pages[0].content.strip() == "日本語です"


def test_gap_between_japanese_and_ascii_is_kept() -> None:
    pages = convert_pdf(_japanese_lines_pdf(["日本", "ABC"]), _limits())

    assert "日本\nABC" in pages[0].content


def test_ascii_page_text_is_not_gap_closed() -> None:
    pages = convert_pdf(make_text_pdf(["Hello world"]), _limits())

    assert pages[0].content.strip() == "Hello world"
