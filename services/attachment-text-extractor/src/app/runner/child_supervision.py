"""Run one child, supervise it and classify how it ended (design: ConversionRunner, 抽出の流れ; Req 2.2, 2.5, 2.6, 2.7).

Everything here runs on the event loop without blocking it: the file goes out and the result
comes back through non-blocking pipes driven by add_writer / add_reader, the child's exit is
awaited on its sentinel, and only Process.start() (a blocking round trip to the forkserver)
runs in a thread.

Classification precedence, highest first:
1. A complete result frame already received (even if the deadline passes in the same tick).
2. What the parent decided and acted on: timeout (deadline), memory_exceeded (RSS),
   result_too_large (frame header over the ceiling). Decided before the SIGKILL, so the
   parent's own kill is never read back as a crash.
3. How the child ended without a result: SIGXCPU -> timeout, anything else -> crashed.
"""

from __future__ import annotations

import asyncio
import logging
import math
import multiprocessing.context
import os
import select
import signal
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from multiprocessing.connection import Connection
from typing import Final

from app.conversion.errors import ConversionFailure
from app.conversion.results import ConversionOutcome
from app.runner import wire
from app.runner.child_entry import ChildParams

logger = logging.getLogger(__name__)

ChildTarget = Callable[[Connection, Connection, Connection, ChildParams], None]

_IO_CHUNK: Final = 1024 * 1024
_KIB: Final = 1024


@dataclass(frozen=True)
class SupervisionTimings:
    poll_interval_s: float
    reap_timeout_s: float
    spawn_timeout_s: float


_TIMEOUT: Final = ConversionFailure(kind="timeout", detail="conversion exceeded the time limit")
_MEMORY: Final = ConversionFailure(kind="memory_exceeded", detail="conversion exceeded the memory limit")
_TOO_LARGE: Final = ConversionFailure(kind="result_too_large", detail="result exceeds the size limit")
_NOT_STARTED: Final = ConversionFailure(kind="crashed", detail="conversion process could not be started")
_BAD_RESULT: Final = ConversionFailure(kind="crashed", detail="conversion process sent an invalid result")


def classify_exit(exitcode: int | None) -> ConversionFailure:
    """A child that ended without sending a result (None: it had not even exited)."""
    if exitcode == -signal.SIGXCPU:
        # RLIMIT_CPU is the backstop for a deadline the parent failed to enforce.
        return _TIMEOUT
    if exitcode is None:
        return ConversionFailure(kind="crashed", detail="conversion process closed its result pipe without a result")
    if exitcode < 0:
        return ConversionFailure(kind="crashed", detail=f"conversion process was killed by signal {-exitcode}")
    # Includes 0, PARENT_GONE_EXIT_CODE and BAD_INPUT_EXIT_CODE: all mean "no result".
    return ConversionFailure(kind="crashed", detail=f"conversion process exited with code {exitcode} without a result")


def parse_status_memory_kib(status: str) -> tuple[int | None, int | None]:
    """(VmRSS, VmHWM) in KiB from /proc/<pid>/status; None where the line is missing (e.g. a zombie)."""
    rss = hwm = None
    for line in status.splitlines():
        if line.startswith("VmRSS:"):
            rss = int(line.split()[1])
        elif line.startswith("VmHWM:"):
            hwm = int(line.split()[1])
    return rss, hwm


async def run_child(
    ctx: multiprocessing.context.ForkServerContext,
    target: ChildTarget,
    data: bytes,
    params: ChildParams,
    timings: SupervisionTimings,
    on_spawn_stuck: Callable[[], None],
) -> ConversionOutcome:
    """One child per call; by the time this returns or raises, the child is killed and reaped."""
    deadline = time.monotonic() + params.timeout_s
    run = _ChildRun(ctx, target, params, timings, on_spawn_stuck)
    try:
        outcome = await run.execute(data, deadline)
    finally:
        await run.dispose()
    return replace(outcome, child_peak_rss_mb=run.peak_rss_mb())


class _Oversize:
    pass


_OVERSIZE: Final = _Oversize()


class _ChildRun:
    def __init__(
        self,
        ctx: multiprocessing.context.ForkServerContext,
        target: ChildTarget,
        params: ChildParams,
        timings: SupervisionTimings,
        on_spawn_stuck: Callable[[], None],
    ) -> None:
        self._loop = asyncio.get_running_loop()
        self._on_spawn_stuck = on_spawn_stuck
        self._params = params
        self._timings = timings
        self._input_child, self._input = ctx.Pipe(duplex=False)
        self._result, self._result_child = ctx.Pipe(duplex=False)
        # The write end stays here for the whole request: the child exits when it closes.
        self._liveness_child, self._liveness = ctx.Pipe(duplex=False)
        self._process = ctx.Process(
            target=target,
            args=(self._input_child, self._result_child, self._liveness_child, params),
            name="conversion-child",
            daemon=True,
        )
        self._spawn: asyncio.Future[None] | None = None
        self._pidfd: int | None = None
        self._tasks: list[asyncio.Future[object]] = []
        self._peak_kib = 0

    def peak_rss_mb(self) -> int | None:
        return math.ceil(self._peak_kib / _KIB) if self._peak_kib else None

    async def execute(self, data: bytes, deadline: float) -> ConversionOutcome:
        failure = await self._start()
        if failure is not None:
            return failure
        self._sample_rss()
        sender = asyncio.ensure_future(self._send(data))
        reader = asyncio.ensure_future(self._read_result())
        self._tasks = [sender, reader]
        return await self._supervise(reader, deadline)

    async def _start(self) -> ConversionFailure | None:
        self._spawn = self._loop.run_in_executor(None, self._process.start)
        # A start() that fails after we stopped waiting must not surface as an unretrieved exception.
        self._spawn.add_done_callback(_consume_exception)
        try:
            await asyncio.wait_for(asyncio.shield(self._spawn), self._timings.spawn_timeout_s)
        except TimeoutError:
            logger.error(
                "forkserver did not start a conversion child in %.1f s; killing it", self._timings.spawn_timeout_s
            )
            self._on_spawn_stuck()
            return _NOT_STARTED
        except Exception as exc:  # noqa: BLE001 - e.g. EOFError right after the forkserver died
            logger.warning("conversion child could not be started: %s", type(exc).__name__)
            return _NOT_STARTED
        self._close_child_ends()
        self._pidfd = _open_pidfd(self._process.pid)
        os.set_blocking(self._input.fileno(), False)
        os.set_blocking(self._result.fileno(), False)
        return None

    async def _supervise(self, reader: asyncio.Future[object], deadline: float) -> ConversionOutcome:
        while True:
            if reader.done():
                return await self._outcome_from(reader)
            now = time.monotonic()
            if now >= deadline:
                return _TIMEOUT
            rss_kib = self._sample_rss()
            if rss_kib is not None and rss_kib > self._params.limits.max_child_rss_mb * _KIB:
                return _MEMORY
            await asyncio.wait({reader}, timeout=min(self._timings.poll_interval_s, deadline - now))

    async def _outcome_from(self, reader: asyncio.Future[object]) -> ConversionOutcome:
        try:
            frame = reader.result()
        except OSError:
            frame = None
        if frame is _OVERSIZE:
            return _TOO_LARGE
        if isinstance(frame, bytes):
            try:
                return wire.decode_result(frame)
            except wire.WireProtocolError:
                return _BAD_RESULT
        # EOF without a full frame: the child is on its way out; let it finish to read why.
        await self._wait_for_exit(self._timings.reap_timeout_s)
        return classify_exit(self._process.exitcode)

    async def _send(self, data: bytes) -> None:
        fd = self._input.fileno()
        try:
            for part in (wire.encode_frame_header(len(data)), data):
                view = memoryview(part)
                while view:
                    try:
                        written = os.write(fd, view[:_IO_CHUNK])
                    except BlockingIOError:
                        await _wait_fd(self._loop, fd, write=True)
                        continue
                    view = view[written:]
        except OSError:
            # The child is gone or stopped reading (EPIPE); how it ended decides the outcome.
            pass
        finally:
            self._input.close()

    async def _read_result(self) -> bytes | _Oversize | None:
        header = await self._read_exact(wire.FRAME_HEADER_SIZE)
        if header is None:
            return None
        try:
            length = wire.decode_frame_header(header, wire.max_result_frame_bytes(self._params.limits.max_result_bytes))
        except wire.WireProtocolError:
            # Nothing of the body is read or buffered; the child is killed right after.
            return _OVERSIZE
        return await self._read_exact(length)

    async def _read_exact(self, length: int) -> bytes | None:
        fd = self._result.fileno()
        buffer = bytearray(length)
        received = 0
        while received < length:
            try:
                chunk = os.read(fd, min(length - received, _IO_CHUNK))
            except BlockingIOError:
                await _wait_fd(self._loop, fd, write=False)
                continue
            if not chunk:
                return None
            buffer[received : received + len(chunk)] = chunk
            received += len(chunk)
        return bytes(buffer)

    def _sample_rss(self) -> int | None:
        if sys.platform != "linux" or self._process.pid is None:
            return None
        try:
            with open(f"/proc/{self._process.pid}/status") as f:
                status = f.read()
        except OSError:
            return None
        if self._has_exited():
            # The pid may already belong to another process.
            return None
        rss, hwm = parse_status_memory_kib(status)
        self._peak_kib = max(self._peak_kib, rss or 0, hwm or 0)
        return rss

    def _has_exited(self) -> bool:
        if self._pidfd is not None:
            readable, _, _ = select.select([self._pidfd], [], [], 0)
            return bool(readable)
        return self._process.exitcode is not None

    async def _wait_for_exit(self, timeout_s: float) -> None:
        if self._process.exitcode is None:
            await _wait_fd(self._loop, self._process.sentinel, write=False, timeout_s=timeout_s)

    async def dispose(self) -> None:
        """Kill, reap and close everything; runs on every path, including cancellation."""
        for task in self._tasks:
            task.cancel()
        self._kill()
        try:
            if self._spawn is not None and not self._spawn.done():
                # Cancelled or timed out mid-spawn: a child may still appear and must be killed too.
                await asyncio.wait({self._spawn}, timeout=self._timings.spawn_timeout_s)
                if not self._spawn.done():
                    logger.error("forkserver did not start a conversion child during clean-up; killing it")
                    self._on_spawn_stuck()
                    await asyncio.wait({self._spawn}, timeout=self._timings.reap_timeout_s)
                self._kill()
            if self._tasks:
                await asyncio.gather(*self._tasks, return_exceptions=True)
            self._liveness.close()
            await self._reap()
        except asyncio.CancelledError:
            self._liveness.close()
            self._reap_blocking()
            raise
        finally:
            self._close_parent_ends()

    def _kill(self) -> None:
        if self._process.pid is None:
            return
        try:
            if self._pidfd is not None:
                signal.pidfd_send_signal(self._pidfd, signal.SIGKILL)
            elif self._process.exitcode is None:
                self._process.kill()
        except ProcessLookupError:
            pass
        except OSError as exc:
            logger.warning("could not kill the conversion child: %s", type(exc).__name__)

    async def _reap(self) -> None:
        self._close_child_ends_if_safe()
        if self._spawn is None or not self._spawn.done() or self._process.pid is None:
            return
        await self._wait_for_exit(self._timings.reap_timeout_s)
        self._finish_reap()

    def _reap_blocking(self) -> None:
        if self._process.pid is not None and self._spawn is not None and self._spawn.done():
            self._process.join(self._timings.reap_timeout_s)
            self._finish_reap()

    def _finish_reap(self) -> None:
        if self._process.exitcode is None:
            logger.error("conversion child did not exit within %.1f s of SIGKILL", self._timings.reap_timeout_s)
            return
        self._process.close()

    def _close_child_ends(self) -> None:
        # The child has its own copies now; ours would keep its pipes from ever reporting EOF.
        for conn in (self._input_child, self._result_child, self._liveness_child):
            conn.close()

    def _close_child_ends_if_safe(self) -> None:
        # While a stuck start() may still be sending these descriptors, closing them could hand
        # the forkserver an unrelated fd that reused the number.
        if self._spawn is None or self._spawn.done():
            self._close_child_ends()
        else:
            logger.error("conversion child start did not return; leaving its pipe ends open")

    def _close_parent_ends(self) -> None:
        for conn in (self._input, self._result, self._liveness):
            conn.close()
        if self._pidfd is not None:
            os.close(self._pidfd)
            self._pidfd = None


async def _wait_fd(loop: asyncio.AbstractEventLoop, fd: int, *, write: bool, timeout_s: float | None = None) -> None:
    ready = loop.create_future()

    def wake() -> None:
        if not ready.done():
            ready.set_result(None)

    (loop.add_writer if write else loop.add_reader)(fd, wake)
    try:
        if timeout_s is None:
            await ready
        else:
            await asyncio.wait({ready}, timeout=timeout_s)
    finally:
        (loop.remove_writer if write else loop.remove_reader)(fd)


def _consume_exception(future: asyncio.Future[None]) -> None:
    if not future.cancelled():
        future.exception()


def _open_pidfd(pid: int | None) -> int | None:
    # A pidfd makes kill and the exit check immune to pid reuse; it may be missing or refused.
    if pid is None or not hasattr(os, "pidfd_open"):
        return None
    try:
        return os.pidfd_open(pid)
    except OSError:
        return None
