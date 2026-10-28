"""Extract router for the attachment-text-extractor service.

Provides:
  POST /extract — multipart file upload

Processing order:
  1. Bearer auth (enforced by BearerAuthMiddleware at the app level, before any of the below)
  2. Declared Content-Length over the cap → 413 file_too_large, without reading the body
  3. Semaphore slot acquisition, before the body is read (ServiceBusyError → 503 service_busy)
  4. Body received under the slot (app.routers.extract_upload): capped while it streams in
     (413), deadlined (408), held in memory only
  5. ConversionRunner.run() in a child process; the outcome is mapped per
     app.routers.extract_errors. No conversion library is called here.

Requirements: 1.1, 1.6, 1.10, 1.11, 2.1, 2.2, 2.3, 2.6, 2.7, 4.2
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Final

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.requests import ClientDisconnect

from app.conversion.errors import ConversionFailure
from app.conversion.results import ConversionSuccess
from app.limits import FileTooLargeError, Limits, ServiceBusyError
from app.routers.extract_errors import FAILURE_RESPONSES
from app.routers.extract_upload import (
    FILE_FIELD,
    MIME_HINT_FIELD,
    InvalidUploadError,
    Upload,
    UploadTimeoutError,
    check_declared_length,
    receive_upload,
)
from app.runner import ConversionRequest, ConversionRunner
from app.schemas import ErrorCode, ErrorResponse, ExtractResponse

logger = logging.getLogger(__name__)

# The handler parses the body itself (see extract_upload), so FastAPI cannot derive the request
# body schema; this is the schema FastAPI generated for the former File / Form parameters.
FORM_SCHEMA_NAME: Final = "Body_post_extract_extract_post"
FORM_SCHEMA: Final[dict[str, Any]] = {
    "properties": {
        FILE_FIELD: {
            "type": "string",
            "contentMediaType": "application/octet-stream",
            "title": "File",
            "description": "File to extract text from",
        },
        MIME_HINT_FIELD: {
            "anyOf": [{"type": "string"}, {"type": "null"}],
            "title": "Mimetype",
            "description": "Optional MIME type hint",
        },
    },
    "type": "object",
    "required": [FILE_FIELD],
    "title": FORM_SCHEMA_NAME,
}

_INVALID_UPLOAD_MESSAGE: Final = "The request must be a multipart/form-data body with one 'file' part"
_UPLOAD_TIMEOUT_MESSAGE: Final = "upload_timeout: the request body was not received in time"
_DISCONNECTED_MESSAGE: Final = "client_disconnected: the request body ended early"


def get_runner(request: Request) -> ConversionRunner:
    """Return the runner the application lifespan stored on ``app.state``."""
    return request.app.state.runner  # type: ignore[no-any-return]


def get_limits(request: Request) -> Limits:
    """Return the intake limits the application lifespan stored on ``app.state``."""
    return request.app.state.limits  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(tags=["extract"])


def _error_response(code: ErrorCode, message: str, status_code: int) -> JSONResponse:
    """Build a JSONResponse from an ErrorResponse model."""
    body = ErrorResponse(code=code, message=message)
    return JSONResponse(content=body.model_dump(), status_code=status_code)


def _success_response(outcome: ConversionSuccess) -> ExtractResponse:
    return ExtractResponse(
        pages=outcome.pages,
        mimeType=outcome.mime_type,
        extractedCharacters=sum(len(page.content) for page in outcome.pages),
    )


def _format_of(filename: str) -> str:
    """Extension only: the file name itself is user-controlled and stays out of the log."""
    suffix = filename.rsplit(".", 1)[-1] if "." in filename else ""
    return re.sub(r"[^a-z0-9]", "", suffix.lower())[:10] or "unknown"


@dataclass
class _RequestLog:
    started: float = field(default_factory=time.perf_counter)
    fmt: str = "unknown"
    size: int = 0

    def write(self, result: str, rss_mb: int | None = None) -> None:
        logger.info(
            "extract format=%s size=%d duration_ms=%d result=%s child_peak_rss_mb=%s",
            self.fmt,
            self.size,
            round((time.perf_counter() - self.started) * 1000),
            result,
            "unknown" if rss_mb is None else rss_mb,
        )


@router.post(
    "/extract",
    response_model=ExtractResponse,
    summary="Extract text from an uploaded file",
    openapi_extra={
        "requestBody": {
            "content": {"multipart/form-data": {"schema": {"$ref": f"#/components/schemas/{FORM_SCHEMA_NAME}"}}},
            "required": True,
        }
    },
    responses={
        400: {"model": ErrorResponse, "description": "Unsupported file format"},
        408: {"model": ErrorResponse, "description": "Extraction timed out"},
        413: {"model": ErrorResponse, "description": "File too large"},
        422: {"model": ErrorResponse, "description": "Encrypted, malformed or over-limit document"},
        500: {"model": ErrorResponse, "description": "Extraction process failed"},
        503: {"model": ErrorResponse, "description": "All concurrency slots are busy"},
    },
)
async def post_extract(request: Request) -> JSONResponse | ExtractResponse:
    """Receive a multipart upload, enforce the slot and size limits, then convert.

    Authentication is handled upstream by BearerAuthMiddleware; this handler
    will only be reached by authenticated requests.
    """
    limits = get_limits(request)
    log = _RequestLog()
    try:
        check_declared_length(request.headers, limits)
        async with limits.acquire_slot():
            upload = await receive_upload(request, limits)
            log.fmt, log.size = _format_of(upload.filename), len(upload.data)
            return await _convert(get_runner(request), upload, log)
    except ServiceBusyError as exc:
        log.write("service_busy")
        return _error_response(ErrorCode.service_busy, str(exc), 503)
    except FileTooLargeError as exc:
        log.write("file_too_large")
        return _error_response(ErrorCode.file_too_large, str(exc), 413)
    except UploadTimeoutError:
        log.write("upload_timeout")
        return _error_response(ErrorCode.extraction_timeout, _UPLOAD_TIMEOUT_MESSAGE, 408)
    except InvalidUploadError:
        log.write("invalid_upload")
        return _error_response(ErrorCode.extraction_failed, _INVALID_UPLOAD_MESSAGE, 422)
    except ClientDisconnect:
        # Nobody is left to read a response; the slot is already released.
        log.write("client_disconnected")
        return _error_response(ErrorCode.extraction_failed, _DISCONNECTED_MESSAGE, 422)


async def _convert(runner: ConversionRunner, upload: Upload, log: _RequestLog) -> JSONResponse | ExtractResponse:
    try:
        outcome = await runner.run(
            ConversionRequest(data=upload.data, filename=upload.filename, mime_hint=upload.mime_hint)
        )
    except Exception:
        # The runner is not meant to raise; anything that does is an unexpected failure of this request only.
        logger.exception("extract runner raised format=%s size=%d", log.fmt, log.size)
        log.write("internal")
        code, status, message = FAILURE_RESPONSES["internal"]
        return _error_response(code, message, status)

    if isinstance(outcome, ConversionSuccess):
        log.fmt = outcome.mime_type
        log.write("ok", outcome.child_peak_rss_mb)
        return _success_response(outcome)

    assert isinstance(outcome, ConversionFailure)
    log.write(outcome.kind, outcome.child_peak_rss_mb)
    code, status, message = FAILURE_RESPONSES[outcome.kind]
    return _error_response(code, message, status)
