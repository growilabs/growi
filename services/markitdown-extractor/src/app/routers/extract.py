"""Extract router for the markitdown-extractor service.

Provides:
  POST /extract — multipart file upload; returns ExtractResponse

Processing order per design.md:
  1. Bearer auth (enforced by BearerAuthMiddleware at the app level)
  2. Semaphore slot acquisition (ServiceBusyError → 503)
  3. File size check (FileTooLargeError → 413)
  4. MIME resolution (UnsupportedFormatError → 400)
  5. Extraction with timeout wrap (ExtractionTimeoutError → 408)
  6. ExtractResponse assembly

Error responses follow ErrorResponse schema with consistent HTTP status
mapping:
  UnsupportedFormatError  → 400 unsupported_format
  FileTooLargeError       → 413 file_too_large
  ExtractionTimeoutError  → 408 extraction_timeout
  ServiceBusyError        → 503 service_busy
  Exception          → 500 extraction_failed

Requirements: 1.1, 1.6, 2.1, 2.2, 2.3, 3.3
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse

from app.config import Settings
from app.limits import ExtractionTimeoutError, FileTooLargeError, Limits, ServiceBusyError
from app.schemas import ErrorCode, ErrorResponse, ExtractResponse
from app.services.extraction_service import UnsupportedFormatError, extract

# ---------------------------------------------------------------------------
# Module-level Limits instance (lazily initialised)
# ---------------------------------------------------------------------------
# ``limits`` is initialised on first use rather than at import time.  This
# avoids a ValidationError during test collection when
# MARKITDOWN_SERVICE_TOKEN has not yet been injected into the environment
# (the autouse fixture runs after collection).
#
# The instance is exposed at module level so tests can patch it directly:
#   patch.object(extract_module.limits, "enforce_size", ...)

limits: Limits | None = None  # populated by _get_limits() on first request


def _get_limits() -> Limits:
    """Return the module-level Limits singleton, creating it on first call."""
    global limits  # noqa: PLW0603
    if limits is None:
        settings = Settings()
        limits = Limits(
            max_file_size_mb=settings.MAX_FILE_SIZE_MB,
            timeout_s=settings.TIMEOUT_S,
            max_concurrency=settings.MAX_CONCURRENCY,
        )
    return limits


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(tags=["extract"])


def _error_response(code: ErrorCode, message: str, status_code: int) -> JSONResponse:
    """Build a JSONResponse from an ErrorResponse model."""
    body = ErrorResponse(code=code, message=message)
    return JSONResponse(content=body.model_dump(), status_code=status_code)


@router.post(
    "/extract",
    response_model=ExtractResponse,
    summary="Extract text from an uploaded file",
)
async def post_extract(
    file: UploadFile = File(..., description="File to extract text from"),  # noqa: B008
    mimeType: str | None = Form(None, description="Optional MIME type hint"),  # noqa: B008, N803
) -> JSONResponse | ExtractResponse:
    """Receive a multipart upload and return extracted text as ExtractResponse.

    Processing order:
    1. Acquire concurrency slot (non-blocking; raises ServiceBusyError if full)
    2. Read file bytes and enforce size limit
    3. Dispatch to extractor with timeout guard
    4. Assemble and return ExtractResponse

    Authentication is handled upstream by BearerAuthMiddleware; this handler
    will only be reached by authenticated requests.
    """
    filename = file.filename or "upload"
    mime_hint = mimeType or None

    # Resolve the limits instance (lazy singleton).
    _limits = _get_limits()

    # Step 1: Acquire concurrency slot.
    try:
        async with _limits.acquire_slot():
            # Step 2: Read file bytes and enforce size.
            data = await file.read()
            try:
                await _limits.enforce_size(data)
            except FileTooLargeError as exc:
                return _error_response(
                    ErrorCode.file_too_large,
                    str(exc),
                    413,
                )

            # Step 3: Dispatch with timeout.
            try:
                pages = await _limits.with_timeout(extract(data, filename, mime_hint=mime_hint))
            except UnsupportedFormatError as exc:
                return _error_response(
                    ErrorCode.unsupported_format,
                    str(exc),
                    400,
                )
            except ExtractionTimeoutError as exc:
                return _error_response(
                    ErrorCode.extraction_timeout,
                    str(exc),
                    408,
                )
            except Exception as exc:
                return _error_response(
                    ErrorCode.extraction_failed,
                    f"Extraction failed: {exc}",
                    500,
                )

    except ServiceBusyError as exc:
        return _error_response(
            ErrorCode.service_busy,
            str(exc),
            503,
        )

    # Step 4: Resolve effective MIME type for the response.
    # Use mime_hint if given; otherwise fall back to what the extractor used.
    # We re-derive from the filename extension to avoid a separate round-trip.
    from app.services.extraction_service import _resolve_mime  # noqa: PLC0415

    resolved_mime = _resolve_mime(filename, mime_hint)

    # Step 5: Assemble response.
    extracted_characters = sum(len(p.content) for p in pages)
    response = ExtractResponse(
        pages=pages,
        mimeType=resolved_mime,
        extractedCharacters=extracted_characters,
    )
    return JSONResponse(content=response.model_dump(), status_code=200)
