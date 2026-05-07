"""Unit tests for the Limits resource-control module (Task 2.1).

Tests cover the three enforcement paths:
  1. Semaphore full → ServiceBusy
  2. File exceeds MAX_FILE_SIZE_MB → FileTooLarge
  3. Coroutine hangs → ExtractionTimeout

Also verifies:
  4. Semaphore is always released (context-manager invariant)
  5. Bytes are checked regardless of any stated Content-Length
  6. Coroutine that completes in time returns its result normally
"""

from __future__ import annotations

import asyncio

import pytest

from app.limits import ExtractionTimeout, FileTooLarge, Limits, ServiceBusy

# Use anyio as the async test runner (pytest-asyncio not installed; anyio plugin is)
pytestmark = pytest.mark.anyio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_limits(
    *,
    max_file_size_mb: int = 10,
    timeout_s: int = 5,
    max_concurrency: int = 2,
) -> Limits:
    """Return a Limits instance with test-friendly defaults."""
    return Limits(
        max_file_size_mb=max_file_size_mb,
        timeout_s=timeout_s,
        max_concurrency=max_concurrency,
    )


# ---------------------------------------------------------------------------
# Exception import / instantiation
# ---------------------------------------------------------------------------

class TestExceptions:
    """Verify that the custom exception classes are importable and usable."""

    def test_service_busy_is_exception(self) -> None:
        exc = ServiceBusy("busy")
        assert isinstance(exc, Exception)

    def test_file_too_large_is_exception(self) -> None:
        exc = FileTooLarge("big")
        assert isinstance(exc, Exception)

    def test_extraction_timeout_is_exception(self) -> None:
        exc = ExtractionTimeout("slow")
        assert isinstance(exc, Exception)


# ---------------------------------------------------------------------------
# acquire_slot — semaphore concurrency control
# ---------------------------------------------------------------------------

class TestAcquireSlot:
    """Tests for the non-blocking semaphore slot acquisition."""

    async def test_first_acquire_succeeds(self) -> None:
        """Acquiring when slots are available should not raise."""
        limits = make_limits(max_concurrency=2)
        async with limits.acquire_slot():
            pass  # should not raise

    async def test_second_acquire_within_capacity_succeeds(self) -> None:
        """Two concurrent acquires within the concurrency limit should both succeed."""
        limits = make_limits(max_concurrency=2)
        async with limits.acquire_slot():
            async with limits.acquire_slot():
                pass  # both slots available — no ServiceBusy

    async def test_service_busy_when_semaphore_full(self) -> None:
        """When all concurrency slots are taken, ServiceBusy must be raised immediately."""
        limits = make_limits(max_concurrency=1)
        async with limits.acquire_slot():
            # semaphore is now at 0 — next acquire should raise, not block
            with pytest.raises(ServiceBusy):
                async with limits.acquire_slot():
                    pass

    async def test_service_busy_with_larger_concurrency(self) -> None:
        """Fill all N slots then verify the (N+1)-th raises ServiceBusy."""
        n = 3
        limits = make_limits(max_concurrency=n)

        # Acquire all N slots manually so they stay held during the test
        for _ in range(n):
            await limits._semaphore.acquire()
        try:
            with pytest.raises(ServiceBusy):
                async with limits.acquire_slot():
                    pass
        finally:
            for _ in range(n):
                limits._semaphore.release()

    async def test_slot_released_on_normal_exit(self) -> None:
        """Semaphore value must be restored after the context manager exits normally."""
        limits = make_limits(max_concurrency=2)
        before = limits._semaphore._value
        async with limits.acquire_slot():
            pass
        after = limits._semaphore._value
        assert after == before

    async def test_slot_released_on_exception_in_body(self) -> None:
        """Semaphore must be released even when the body raises an exception."""
        limits = make_limits(max_concurrency=1)
        before = limits._semaphore._value

        with pytest.raises(RuntimeError):
            async with limits.acquire_slot():
                raise RuntimeError("body error")

        after = limits._semaphore._value
        assert after == before  # slot was released despite the exception

    async def test_slot_reusable_after_release(self) -> None:
        """After a slot is released, the next acquire should succeed."""
        limits = make_limits(max_concurrency=1)
        async with limits.acquire_slot():
            pass
        # Second usage — slot was released, should not raise
        async with limits.acquire_slot():
            pass


# ---------------------------------------------------------------------------
# enforce_size — streaming byte-count check
# ---------------------------------------------------------------------------

class TestEnforceSize:
    """Tests for the accumulated byte-size enforcement."""

    async def test_exactly_at_limit_does_not_raise(self) -> None:
        """Data exactly equal to the limit must be accepted."""
        limits = make_limits(max_file_size_mb=1)
        data = b"x" * (1 * 1024 * 1024)  # exactly 1 MiB
        await limits.enforce_size(data)  # should not raise

    async def test_one_byte_over_limit_raises_file_too_large(self) -> None:
        """A single byte over the limit must raise FileTooLarge."""
        limits = make_limits(max_file_size_mb=1)
        data = b"x" * (1 * 1024 * 1024 + 1)
        with pytest.raises(FileTooLarge):
            await limits.enforce_size(data)

    async def test_empty_data_is_accepted(self) -> None:
        """Empty bytes must always be accepted."""
        limits = make_limits(max_file_size_mb=1)
        await limits.enforce_size(b"")  # should not raise

    async def test_large_data_raises_file_too_large(self) -> None:
        """Data significantly larger than the limit raises FileTooLarge."""
        limits = make_limits(max_file_size_mb=1)
        data = b"x" * (10 * 1024 * 1024)  # 10 MiB >> 1 MiB limit
        with pytest.raises(FileTooLarge):
            await limits.enforce_size(data)

    async def test_file_too_large_regardless_of_stated_size(self) -> None:
        """Actual byte count is checked, not any externally-stated Content-Length.

        This test documents the header-spoofing defense: enforce_size receives
        the actual accumulated bytes and enforces the limit regardless of what
        the HTTP client claimed the size would be.
        """
        limits = make_limits(max_file_size_mb=1)
        # Caller previously checked Content-Length = 512 KiB (within limit),
        # but the actual body accumulated to 2 MiB (beyond limit).
        stated_content_length = 512 * 1024  # header said 512 KiB — within limit
        actual_data = b"x" * (2 * 1024 * 1024)  # actual body is 2 MiB
        assert len(actual_data) > stated_content_length  # sanity
        with pytest.raises(FileTooLarge):
            await limits.enforce_size(actual_data)

    async def test_file_too_large_message_contains_limit(self) -> None:
        """The FileTooLarge exception message must mention the configured limit."""
        limit_mb = 5
        limits = make_limits(max_file_size_mb=limit_mb)
        data = b"x" * (limit_mb * 1024 * 1024 + 1)
        with pytest.raises(FileTooLarge, match=str(limit_mb)):
            await limits.enforce_size(data)


# ---------------------------------------------------------------------------
# with_timeout — asyncio.wait_for wrapper
# ---------------------------------------------------------------------------

class TestWithTimeout:
    """Tests for the extraction-timeout wrapper."""

    async def test_fast_coroutine_returns_result(self) -> None:
        """A coroutine that completes well within the timeout returns its value."""
        limits = make_limits(timeout_s=5)

        async def fast_coro() -> str:
            return "done"

        result = await limits.with_timeout(fast_coro())
        assert result == "done"

    async def test_slow_coroutine_raises_extraction_timeout(self) -> None:
        """A coroutine that exceeds the timeout must raise ExtractionTimeout."""
        limits = make_limits(timeout_s=1)

        async def slow_coro() -> None:
            await asyncio.sleep(10)  # much longer than timeout_s=1

        with pytest.raises(ExtractionTimeout):
            await limits.with_timeout(slow_coro())

    async def test_extraction_timeout_message_contains_timeout(self) -> None:
        """The ExtractionTimeout message must mention the configured timeout."""
        timeout_s = 1
        limits = make_limits(timeout_s=timeout_s)

        async def slow_coro() -> None:
            await asyncio.sleep(10)

        with pytest.raises(ExtractionTimeout, match=str(timeout_s)):
            await limits.with_timeout(slow_coro())

    async def test_coroutine_exception_propagates_unchanged(self) -> None:
        """Non-timeout exceptions from the wrapped coroutine must propagate as-is."""
        limits = make_limits(timeout_s=5)

        async def raising_coro() -> None:
            raise ValueError("extractor error")

        with pytest.raises(ValueError, match="extractor error"):
            await limits.with_timeout(raising_coro())

    async def test_timeout_is_not_wrapped_as_asyncio_error(self) -> None:
        """asyncio.TimeoutError must be caught and re-raised as ExtractionTimeout."""
        limits = make_limits(timeout_s=1)

        async def slow_coro() -> None:
            await asyncio.sleep(10)

        # Must NOT be asyncio.TimeoutError — must be ExtractionTimeout
        with pytest.raises(ExtractionTimeout):
            await limits.with_timeout(slow_coro())

    async def test_with_timeout_returns_none_for_void_coroutine(self) -> None:
        """A coroutine that returns None should work without issue."""
        limits = make_limits(timeout_s=5)

        async def void_coro() -> None:
            pass

        result = await limits.with_timeout(void_coro())
        assert result is None
