"""Extract router for the attachment-text-extractor service.

Provides:
  POST /extract — multipart file upload

Processing order:
  1. Bearer auth (enforced by BearerAuthMiddleware at the app level)
  2. Semaphore slot acquisition (ServiceBusyError → 503 service_busy)
  3. File size check (FileTooLargeError → 413 file_too_large)
  4. Conversion — not wired yet; responds 503 until the
     conversion runner is connected to this router.

Requirements: 2.1, 2.3, 3.3
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse

from app.config import Settings
from app.limits import FileTooLargeError, Limits, ServiceBusyError
from app.schemas import ErrorCode, ErrorResponse, ExtractResponse

# ---------------------------------------------------------------------------
# Module-level Limits instance (lazily initialised)
# ---------------------------------------------------------------------------
# ``limits`` is initialised on first use rather than at import time.  This
# avoids a ValidationError during test collection when
# ATTACHMENT_EXTRACTOR_SERVICE_TOKEN has not yet been injected into the environment
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
    """Receive a multipart upload, enforce the slot and size limits, then convert.

    Authentication is handled upstream by BearerAuthMiddleware; this handler
    will only be reached by authenticated requests.
    """
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

            # Step 3: Conversion is not wired yet.
            return _error_response(
                ErrorCode.extraction_failed,
                "Text extraction is temporarily unavailable",
                503,
            )

    except ServiceBusyError as exc:
        return _error_response(
            ErrorCode.service_busy,
            str(exc),
            503,
        )
