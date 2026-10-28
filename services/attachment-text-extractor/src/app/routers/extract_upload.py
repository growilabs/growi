"""Receiving the POST /extract multipart body: capped, deadlined and held in memory only.

The router parses the body itself instead of declaring `File` / `Form` parameters: FastAPI
reads such a body before the handler (and its dependencies) run, so the concurrency slot could
not be taken first, the size could only be checked after the whole body was in, and Starlette
spools every file part over 1 MiB to TMPDIR, which is a small tmpfs in production that only
holds the forkserver socket.

Requirements: 2.1, 2.3, 4.2
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import dataclass
from typing import Final

from python_multipart.exceptions import FormParserError
from python_multipart.multipart import parse_options_header
from starlette.datastructures import Headers, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser
from starlette.requests import Request

from app.limits import Limits

FILE_FIELD: Final = "file"
MIME_HINT_FIELD: Final = "mimeType"
_MULTIPART: Final = b"multipart/form-data"


class UploadTimeoutError(Exception):
    """The body did not arrive within the upload deadline."""


class InvalidUploadError(Exception):
    """The body is not a multipart form with one `file` part."""


@dataclass(frozen=True)
class Upload:
    data: bytes
    filename: str
    mime_hint: str | None


class _InMemoryMultiPartParser(MultiPartParser):
    # Never roll over to a temporary file; the body size is already capped by the stream.
    spool_max_size = sys.maxsize


def check_declared_length(headers: Headers, limits: Limits) -> None:
    """Reject a body whose Content-Length is already over the cap, before reading anything.

    Only an early rejection: the received bytes are still counted (a missing or false
    Content-Length must not bypass the cap). h11 has already rejected a malformed header.
    """
    declared = headers.get("content-length")
    if declared is not None and declared.isdigit():
        limits.check_body_size(int(declared))


async def receive_upload(request: Request, limits: Limits) -> Upload:
    """Read the body under `limits` (the caller holds a concurrency slot).

    Raises:
        FileTooLargeError: The body or the file is over the size limit.
        UploadTimeoutError: The body took longer than `limits.upload_timeout_s`.
        InvalidUploadError: Not a multipart form with a `file` part.
        ClientDisconnect: The client went away mid-body.
    """
    content_type, _ = parse_options_header(request.headers.get("content-type", ""))
    if content_type != _MULTIPART:
        raise InvalidUploadError
    parser = _InMemoryMultiPartParser(request.headers, _capped(request.stream(), limits), max_files=1)
    try:
        async with asyncio.timeout(limits.upload_timeout_s):
            form = await parser.parse()
    except TimeoutError:
        raise UploadTimeoutError from None
    except (MultiPartException, FormParserError):
        raise InvalidUploadError from None
    try:
        return await _upload_from(form.get(FILE_FIELD), form.get(MIME_HINT_FIELD), limits)
    finally:
        await form.close()


async def _upload_from(file: object, mime_hint: object, limits: Limits) -> Upload:
    if not isinstance(file, UploadFile) or not isinstance(mime_hint, str | None):
        raise InvalidUploadError
    data = await file.read()
    await limits.enforce_size(data)
    # An empty form value means "no hint", as FastAPI's Form(None) treated it.
    return Upload(data=data, filename=file.filename or "", mime_hint=mime_hint or None)


async def _capped(stream: AsyncIterator[bytes], limits: Limits) -> AsyncGenerator[bytes, None]:
    received = 0
    async for chunk in stream:
        received += len(chunk)
        limits.check_body_size(received)
        yield chunk
