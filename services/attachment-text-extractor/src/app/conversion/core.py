"""Single entry point of the conversion layer: format detection through result assembly (Req 1.1-1.12, 2.6)."""

from app.conversion.errors import ConversionError
from app.conversion.formats import ResolvedFormat, resolve_format
from app.conversion.limits import ConversionLimits
from app.conversion.normalize import normalize_newlines
from app.conversion.office import convert_office
from app.conversion.pdf import convert_pdf
from app.conversion.pptx_split import convert_pptx
from app.conversion.results import ConversionSuccess
from app.conversion.text import convert_text
from app.conversion.xlsx_split import convert_xlsx
from app.schemas import PageInfo


def convert(data: bytes, filename: str, mime_hint: str | None, limits: ConversionLimits) -> ConversionSuccess:
    """Raise ConversionError on any failure; its detail never contains file content.

    SystemExit / KeyboardInterrupt (BaseException) propagate: the child entry owns that policy (design: ChildEntry).
    """
    resolved = resolve_format(filename, mime_hint)
    try:
        pages = _convert_by_route(data, resolved, limits)
    except ConversionError:
        raise
    except Exception as exc:
        # Only the class name: messages from converters may quote input bytes.
        raise ConversionError("internal", type(exc).__name__) from None
    return ConversionSuccess(pages=_assemble(pages, limits), mime_type=resolved.mime_type)


def _convert_by_route(data: bytes, resolved: ResolvedFormat, limits: ConversionLimits) -> list[PageInfo]:
    match resolved.route:
        case "pdf":
            return convert_pdf(data, limits)
        case "pptx":
            return convert_pptx(data, limits)
        case "xlsx":
            return convert_xlsx(data, limits)
        case "office":
            assert resolved.anydoc_format is not None  # noqa: S101 - table invariant
            return [PageInfo(pageNumber=None, label=None, content=convert_office(data, resolved.anydoc_format))]
        case "text":
            assert resolved.text_kind is not None  # noqa: S101 - table invariant
            return [PageInfo(pageNumber=None, label=None, content=convert_text(data, resolved.text_kind, limits))]


def _assemble(pages: list[PageInfo], limits: ConversionLimits) -> list[PageInfo]:
    kept: list[PageInfo] = []
    total_bytes = 0
    for page in pages:
        content = normalize_newlines(page.content)
        if content == "":
            continue
        total_bytes += len(content.encode("utf-8", errors="surrogatepass"))
        # Checked per element so an oversized result is rejected before it is joined or copied further.
        if total_bytes > limits.max_result_bytes:
            raise ConversionError("result_too_large", "extracted text exceeds the result limit")
        kept.append(PageInfo(pageNumber=page.pageNumber, label=page.label, content=content))
    return kept or [PageInfo(pageNumber=None, label=None, content="")]
