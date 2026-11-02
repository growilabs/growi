"""Abandon a conversion once the client that asked for it has gone away (Req 2.9).

After the body has been read, the ASGI server's receive() only answers with `http.disconnect`,
and it does so when the connection closes. A task blocked on receive() therefore sees the
disconnect at once, without polling. Starlette's `Request.is_disconnected()` is not used: it
reads receive() inside an already-cancelled scope, and through the BaseHTTPMiddleware layers
that cancellation discards the message, so it never reports a disconnect here.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Coroutine
from typing import Any

logger = logging.getLogger(__name__)

Receive = Callable[[], Awaitable[Any]]


async def run_while_connected[T](receive: Receive, work: Coroutine[Any, Any, T]) -> T | None:
    """Await `work`; return None if the client disconnects first, after `work` has been cancelled.

    `work` is always finished (returned, raised or cancelled and done with its clean-up) before
    this returns or raises, also when the caller itself is cancelled: the runner kills and reaps
    its child in that clean-up, and the caller releases the concurrency slot only afterwards.
    """
    run: asyncio.Task[T] = asyncio.ensure_future(work)
    watch = asyncio.ensure_future(_wait_for_disconnect(receive))
    try:
        await asyncio.wait((run, watch), return_when=asyncio.FIRST_COMPLETED)
        if not run.done() and watch.exception() is not None:
            # A receive that breaks tells nothing about the client; keep converting.
            logger.warning("disconnect watch failed: %s", type(watch.exception()).__name__)
            await asyncio.wait((run,))
    finally:
        watch.cancel()
        run.cancel()
        await asyncio.gather(run, watch, return_exceptions=True)
    if run.cancelled():
        return None
    return run.result()


async def _wait_for_disconnect(receive: Receive) -> None:
    while (await receive())["type"] != "http.disconnect":
        pass
