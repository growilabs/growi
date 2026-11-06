"""run_while_connected: the conversion is abandoned as soon as the client goes away (Req 2.3, 2.5).

The real server path is covered by tests/test_live_disconnect.py; these pin the cancellation
rules with a fake ASGI receive and a fake conversion.
"""

from __future__ import annotations

import asyncio

import pytest

from app.routers.client_disconnect import run_while_connected

pytestmark = pytest.mark.anyio

GUARD_S = 5.0


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeReceive:
    """An ASGI receive that blocks until `disconnect()` (or `fail()`) is called."""

    def __init__(self) -> None:
        self._event = asyncio.Event()
        self._error: Exception | None = None
        self.calls = 0
        self.cancelled = False

    def disconnect(self) -> None:
        self._event.set()

    def fail(self, error: Exception) -> None:
        self._error = error
        self._event.set()

    async def __call__(self) -> dict[str, object]:
        self.calls += 1
        try:
            await self._event.wait()
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        if self._error is not None:
            raise self._error
        return {"type": "http.disconnect"}


class FakeConversion:
    """Stands in for runner.run(): records whether it was cancelled and whether its clean-up finished."""

    def __init__(self, seconds: float, result: object = "converted") -> None:
        self.seconds = seconds
        self.result = result
        self.started = asyncio.Event()
        self.cancelled = False
        self.cleaned_up = False

    async def __call__(self) -> object:
        self.started.set()
        try:
            await asyncio.sleep(self.seconds)
            return self.result
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        finally:
            # The runner kills and reaps the child here; it must finish before the caller moves on.
            await asyncio.sleep(0.05)
            self.cleaned_up = True


async def test_a_conversion_that_finishes_returns_its_result_and_stops_watching() -> None:
    receive, conversion = FakeReceive(), FakeConversion(0.05)

    result = await asyncio.wait_for(run_while_connected(receive, conversion()), GUARD_S)

    assert result == "converted"
    assert not conversion.cancelled
    assert receive.cancelled


async def test_a_disconnect_cancels_the_conversion_and_waits_for_its_clean_up() -> None:
    receive, conversion = FakeReceive(), FakeConversion(60)
    task = asyncio.ensure_future(run_while_connected(receive, conversion()))
    await asyncio.wait_for(conversion.started.wait(), GUARD_S)

    receive.disconnect()
    result = await asyncio.wait_for(task, GUARD_S)

    assert result is None
    assert conversion.cancelled
    assert conversion.cleaned_up


async def test_cancelling_the_caller_cancels_the_conversion_before_it_propagates() -> None:
    receive, conversion = FakeReceive(), FakeConversion(60)
    task = asyncio.ensure_future(run_while_connected(receive, conversion()))
    await asyncio.wait_for(conversion.started.wait(), GUARD_S)

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, GUARD_S)

    assert conversion.cancelled
    assert conversion.cleaned_up
    assert receive.cancelled


async def test_a_broken_receive_does_not_abandon_the_conversion() -> None:
    receive, conversion = FakeReceive(), FakeConversion(0.2)
    task = asyncio.ensure_future(run_while_connected(receive, conversion()))
    await asyncio.wait_for(conversion.started.wait(), GUARD_S)

    receive.fail(RuntimeError("Unexpected message received: http.request"))
    result = await asyncio.wait_for(task, GUARD_S)

    assert result == "converted"
    assert not conversion.cancelled


async def test_messages_other_than_disconnect_keep_the_watch_going() -> None:
    conversion = FakeConversion(60)
    messages = [{"type": "http.request", "body": b"", "more_body": False}, {"type": "http.disconnect"}]

    async def receive() -> dict[str, object]:
        await asyncio.sleep(0.01)
        return messages.pop(0)

    result = await asyncio.wait_for(run_while_connected(receive, conversion()), GUARD_S)

    assert result is None
    assert conversion.cancelled


async def test_an_exception_from_the_conversion_propagates() -> None:
    async def failing() -> object:
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        await asyncio.wait_for(run_while_connected(FakeReceive(), failing()), GUARD_S)
