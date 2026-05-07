"""Resource-limit enforcement for the markitdown-extractor service.

Provides the Limits class that wraps three protection mechanisms:

1. Concurrency control (Req 2.3): a global asyncio.Semaphore limits the number
   of simultaneous extractions.  Acquisition is non-blocking — if no slot is
   available the caller receives ServiceBusyError immediately instead of queuing.

2. Upload size enforcement (Req 2.1): enforce_size checks the actual accumulated
   byte count against MAX_FILE_SIZE_MB.  This is performed *after* reading the
   body so that a spoofed Content-Length header cannot bypass the check.

3. Extraction timeout (Req 2.2): with_timeout wraps an awaitable in
   asyncio.wait_for and converts asyncio.TimeoutError into ExtractionTimeoutError
   so callers always receive a domain-level exception.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from typing import TypeVar

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class ServiceBusyError(Exception):
    """Raised when the concurrency semaphore is fully exhausted (Req 2.3)."""


class FileTooLargeError(Exception):
    """Raised when the uploaded file exceeds the configured size limit (Req 2.1)."""


class ExtractionTimeoutError(Exception):
    """Raised when extraction exceeds the configured timeout (Req 2.2)."""


# ---------------------------------------------------------------------------
# Limits class
# ---------------------------------------------------------------------------


class Limits:
    """Centralised resource-limit enforcer.

    Create one instance at application startup (typically as a module-level
    singleton) and inject it wherever upload handling or extraction occurs.

    Args:
        max_file_size_mb: Maximum accepted file size in mebibytes.
        timeout_s: Maximum seconds allowed for a single extraction.
        max_concurrency: Maximum simultaneous extraction slots.
    """

    def __init__(
        self,
        *,
        max_file_size_mb: int,
        timeout_s: int,
        max_concurrency: int,
    ) -> None:
        self._max_bytes: int = max_file_size_mb * 1024 * 1024
        self._max_file_size_mb: int = max_file_size_mb
        self._timeout_s: int = timeout_s
        self._semaphore: asyncio.Semaphore = asyncio.Semaphore(max_concurrency)

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

    async def enforce_size(self, data: bytes) -> None:
        """Check that accumulated bytes do not exceed the configured limit.

        This must be called with the *actual* body bytes after the upload has
        been read, not with the stated Content-Length value.  This ensures a
        client cannot bypass the check by lying about the header (Req 4.2).

        Args:
            data: The complete, accumulated request body bytes.

        Raises:
            FileTooLargeError: When ``len(data)`` exceeds the configured limit.
        """
        if len(data) > self._max_bytes:
            raise FileTooLargeError(f"File size {len(data)} bytes exceeds the {self._max_file_size_mb} MiB limit")

    async def with_timeout(self, coro: Awaitable[T]) -> T:
        """Wrap an awaitable with the configured extraction timeout.

        Converts :class:`asyncio.TimeoutError` into the domain-level
        :class:`ExtractionTimeoutError` so callers never have to handle the
        asyncio primitive directly.

        Args:
            coro: The awaitable to run (typically an extraction coroutine).

        Returns:
            The value returned by *coro*.

        Raises:
            ExtractionTimeoutError: When *coro* does not complete within
                ``timeout_s`` seconds.
        """
        try:
            return await asyncio.wait_for(coro, timeout=self._timeout_s)
        except TimeoutError as err:
            raise ExtractionTimeoutError(f"Extraction timed out after {self._timeout_s}s") from err
