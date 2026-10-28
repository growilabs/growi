"""Extract router for the attachment-text-extractor service.

Provides:
  POST /extract — multipart file upload

Processing order:
  1. Bearer auth (enforced by BearerAuthMiddleware at the app level)
  2. Semaphore slot acquisition (ServiceBusyError → 503 service_busy)
  3. File size check (FileTooLargeError → 413 file_too_large)
  4. ConversionRunner.run() in a child process; the outcome is mapped per
     app.routers.extract_errors. No conversion library is called here.

Requirements: 1.1, 1.6, 1.10, 1.11, 2.1, 2.2, 2.3, 2.6, 2.7, 4.2
"""

from __future__ import annotations

import logging
import re
import time

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from app.config import Settings
from app.conversion.errors import ConversionFailure
from app.conversion.results import ConversionSuccess
from app.limits import FileTooLargeError, Limits, ServiceBusyError
from app.routers.extract_errors import FAILURE_RESPONSES
from app.runner import ConversionRequest, ConversionRunner
from app.schemas import ErrorCode, ErrorResponse, ExtractResponse

logger = logging.getLogger(__name__)

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
            max_concurrency=settings.MAX_CONCURRENCY,
        )
    return limits


def get_runner(request: Request) -> ConversionRunner:
    """Return the runner the application lifespan stored on ``app.state``."""
    return request.app.state.runner  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(tags=["extract"])


def _error_response(code: ErrorCode, message: str, status_code: int) -> JSONResponse:
    """Build a JSONResponse from an ErrorResponse model."""
    body = ErrorResponse(code=code, message=message)
    return JSONResponse(content=body.model_dump(), status_code=status_code)


def _json_safe(text: str) -> str:
    """Replace lone surrogates, which would make the JSON response fail to encode."""
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        return text.encode("utf-8", errors="replace").decode("utf-8")
    return text


def _success_response(outcome: ConversionSuccess) -> ExtractResponse:
    pages = [page.model_copy(update={"content": _json_safe(page.content)}) for page in outcome.pages]
    return ExtractResponse(
        pages=pages,
        mimeType=outcome.mime_type,
        extractedCharacters=sum(len(page.content) for page in pages),
    )


def _format_of(filename: str) -> str:
    """Extension only: the file name itself is user-controlled and stays out of the log."""
    suffix = filename.rsplit(".", 1)[-1] if "." in filename else ""
    return re.sub(r"[^a-z0-9]", "", suffix.lower())[:10] or "unknown"


def _log_request(*, fmt: str, size: int, started: float, result: str, rss_mb: int | None) -> None:
    logger.info(
        "extract format=%s size=%d duration_ms=%d result=%s child_peak_rss_mb=%s",
        fmt,
        size,
        round((time.perf_counter() - started) * 1000),
        result,
        "unknown" if rss_mb is None else rss_mb,
    )


@router.post(
    "/extract",
    response_model=ExtractResponse,
    summary="Extract text from an uploaded file",
)
async def post_extract(
    request: Request,
    file: UploadFile = File(..., description="File to extract text from"),  # noqa: B008
    mimeType: str | None = Form(None, description="Optional MIME type hint"),  # noqa: B008, N803
) -> JSONResponse | ExtractResponse:
    """Receive a multipart upload, enforce the slot and size limits, then convert.

    Authentication is handled upstream by BearerAuthMiddleware; this handler
    will only be reached by authenticated requests.
    """
    _limits = _get_limits()
    runner = get_runner(request)
    filename = file.filename or ""
    fmt = _format_of(filename)
    started = time.perf_counter()

    try:
        async with _limits.acquire_slot():
            data = await file.read()
            try:
                await _limits.enforce_size(data)
            except FileTooLargeError as exc:
                _log_request(fmt=fmt, size=len(data), started=started, result="file_too_large", rss_mb=None)
                return _error_response(ErrorCode.file_too_large, str(exc), 413)

            try:
                outcome = await runner.run(ConversionRequest(data=data, filename=filename, mime_hint=mimeType))
            except Exception:
                # The runner is not meant to raise; anything that does is an unexpected failure of this request only.
                logger.exception("extract runner raised format=%s size=%d", fmt, len(data))
                _log_request(fmt=fmt, size=len(data), started=started, result="internal", rss_mb=None)
                code, status, message = FAILURE_RESPONSES["internal"]
                return _error_response(code, message, status)

            if isinstance(outcome, ConversionSuccess):
                _log_request(
                    fmt=outcome.mime_type,
                    size=len(data),
                    started=started,
                    result="ok",
                    rss_mb=outcome.child_peak_rss_mb,
                )
                return _success_response(outcome)

            assert isinstance(outcome, ConversionFailure)
            _log_request(
                fmt=fmt, size=len(data), started=started, result=outcome.kind, rss_mb=outcome.child_peak_rss_mb
            )
            code, status, message = FAILURE_RESPONSES[outcome.kind]
            return _error_response(code, message, status)

    except ServiceBusyError as exc:
        logger.info("extract format=%s result=service_busy", fmt)
        return _error_response(ErrorCode.service_busy, str(exc), 503)
