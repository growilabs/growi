"""Resource-limit enforcement for the attachment-text-extractor service.

Provides the Limits class that wraps the request intake limits:

1. Concurrency control (Req 2.3): a global asyncio.Semaphore limits the number
   of simultaneous extractions.  Acquisition is non-blocking — if no slot is
   available the caller receives ServiceBusyError immediately instead of queuing.

2. Upload size enforcement (Req 2.1): the body is capped at ``max_body_bytes``
   while it streams in, and enforce_size checks the received file bytes against
   MAX_FILE_SIZE_MB.  Both count the bytes that actually arrived, so a spoofed
   Content-Length header cannot bypass the check.

3. Upload deadline: receiving one body may take at most ``upload_timeout_s``.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from app.config import Settings

_MIB: Final = 1024 * 1024
# Room for the multipart framing around the file: boundaries, part headers (the file name) and
# the short mimeType field.
MULTIPART_OVERHEAD_BYTES: Final = 64 * 1024

# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class ServiceBusyError(Exception):
    """Raised when the concurrency semaphore is fully exhausted (Req 2.3)."""


class FileTooLargeError(Exception):
    """Raised when the uploaded file exceeds the configured size limit (Req 2.1)."""


# ---------------------------------------------------------------------------
# Limits class
# ---------------------------------------------------------------------------


class Limits:
    """Centralised resource-limit enforcer.

    Create one instance per application (``Limits.from_settings`` in the lifespan, stored on
    ``app.state.limits``) and read it wherever upload handling occurs.

    Args:
        max_file_size_mb: Maximum accepted file size in mebibytes.
        max_concurrency: Maximum simultaneous extraction slots.
        upload_timeout_s: Maximum seconds for receiving one request body.
    """

    def __init__(
        self,
        *,
        max_file_size_mb: int,
        max_concurrency: int,
        upload_timeout_s: float,
    ) -> None:
        self._max_bytes: int = max_file_size_mb * _MIB
        self._max_file_size_mb: int = max_file_size_mb
        self._semaphore: asyncio.Semaphore = asyncio.Semaphore(max_concurrency)
        self._upload_timeout_s: float = upload_timeout_s

    @classmethod
    def from_settings(cls, settings: Settings) -> Limits:
        return cls(
            max_file_size_mb=settings.MAX_FILE_SIZE_MB,
            max_concurrency=settings.MAX_CONCURRENCY,
            upload_timeout_s=settings.UPLOAD_TIMEOUT_S,
        )

    @property
    def max_body_bytes(self) -> int:
        """Cap on the whole multipart body: the file limit plus the framing around it."""
        return self._max_bytes + MULTIPART_OVERHEAD_BYTES

    @property
    def upload_timeout_s(self) -> float:
        return self._upload_timeout_s

    @asynccontextmanager
    async def acquire_slot(self) -> AsyncIterator[None]:
        """Non-blocking semaphore slot acquisition.

        Attempts to acquire a concurrency slot without blocking.  If the
        semaphore has no available slots (``_value == 0``), raises
        :class:`ServiceBusyError` immediately rather than suspending the caller.

        The slot is guaranteed to be released when the ``async with`` block
        exits, regardless of whether the body raises an exception.

        Raises:
            ServiceBusyError: When no concurrency slots are available.
        """
        if self._semaphore._value == 0:  # non-blocking check: no slots left
            raise ServiceBusyError("Service is at maximum concurrency — try again later")
        # A slot is available; acquire it.  Because we only reach this line
        # when _value > 0, the acquire call will not suspend.
        await self._semaphore.acquire()
        try:
            yield
        finally:
            self._semaphore.release()

    def check_body_size(self, received_bytes: int) -> None:
        """Reject a body (received so far, or declared by Content-Length) above ``max_body_bytes``.

        Raises:
            FileTooLargeError: When ``received_bytes`` exceeds the body cap.
        """
        if received_bytes > self.max_body_bytes:
            raise FileTooLargeError(f"Request body exceeds the {self._max_file_size_mb} MiB file size limit")

    async def enforce_size(self, data: bytes) -> None:
        """Check that the received file bytes do not exceed the configured limit.

        This must be called with the *actual* file bytes after the upload has
        been read, not with the stated Content-Length value.  This ensures a
        client cannot bypass the check by lying about the header (Req 4.2).

        Args:
            data: The complete file bytes.

        Raises:
            FileTooLargeError: When ``len(data)`` exceeds the configured limit.
        """
        if len(data) > self._max_bytes:
            raise FileTooLargeError(f"File size {len(data)} bytes exceeds the {self._max_file_size_mb} MiB limit")
