"""PDF conversion page by page through pypdfium2 (Req 1.4, 1.9, 1.10, 1.11, 1.12, 2.6)."""

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw

from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits
from app.conversion.normalize import join_broken_japanese, normalize_newlines
from app.schemas import PageInfo

# FPDF_ERR_PASSWORD / FPDF_ERR_SECURITY: only raised when the user password is needed.
# An owner-password-only PDF opens normally and never reaches this branch (Req 1.12).
_PASSWORD_ERRORS = frozenset({pdfium_raw.FPDF_ERR_PASSWORD, pdfium_raw.FPDF_ERR_SECURITY})


def convert_pdf(data: bytes, limits: ConversionLimits) -> list[PageInfo]:
    """Return one element per page; raise ConversionError whose detail never contains file content.

    Pages without text stay as elements with empty content; ConversionCore drops them later.
    The page text is not capped here: MAX_RESULT_BYTES is enforced on the whole result.
    """
    document = _open(data)
    try:
        # Checked before iterating so a forged huge page tree cannot burn time or memory.
        if len(document) > limits.max_pdf_pages:
            raise ConversionError("limit_exceeded", "PDF page count exceeds the limit")
        return [
            PageInfo(pageNumber=number, label=str(number), content=_page_text(document, number - 1))
            for number in range(1, len(document) + 1)
        ]
    except pdfium.PdfiumError:
        # pypdfium2 messages describe the failing call, not the content, but the detail is fixed text on purpose.
        raise ConversionError("malformed", "PDF page could not be read") from None
    finally:
        document.close()


def _open(data: bytes) -> pdfium.PdfDocument:
    try:
        return pdfium.PdfDocument(data)
    except pdfium.PdfiumError as exc:
        if exc.err_code in _PASSWORD_ERRORS:
            raise ConversionError("encrypted", "PDF requires a password to open") from None
        raise ConversionError("malformed", "PDF could not be opened") from None


def _page_text(document: pdfium.PdfDocument, index: int) -> str:
    page = document[index]
    try:
        textpage = page.get_textpage()
        try:
            text = textpage.get_text_range()
        finally:
            textpage.close()
    finally:
        page.close()
    # PDFium separates lines with CRLF; the gap closing relies on LF.
    return join_broken_japanese(normalize_newlines(text))
