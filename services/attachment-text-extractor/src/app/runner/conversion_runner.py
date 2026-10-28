"""Per-request conversion child management (design: ConversionRunner; Req 2.2, 2.5, 2.6, 2.7, 3.2).

Children are forked from one forkserver per worker process that has already imported the
conversion dependencies, so a child does not pay the import cost again (research.md 1.3, 3.8).
run() hands one request to one child; the supervision itself lives in child_supervision.
"""

from __future__ import annotations

import asyncio
import json
import logging
import multiprocessing
import multiprocessing.forkserver
import os
import select
import signal
import sys
import threading
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from multiprocessing.connection import Connection
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Final

from app.conversion.limits import ConversionLimits
from app.conversion.results import ConversionOutcome
from app.runner.child_entry import ChildParams, child_main
from app.runner.child_supervision import ChildTarget, SupervisionTimings, run_child

if TYPE_CHECKING:
    from app.config import Settings

logger = logging.getLogger(__name__)

# Imported once inside the forkserver. app.runner.child_entry pulls in all of app.conversion;
# none of these may import app.main / app.config (they need the service token at import time).
CONVERSION_DEPENDENCIES: Final[tuple[str, ...]] = (
    "anydoc",
    "pypdfium2",
    "charset_normalizer",
    "app.runner.child_entry",
)

# The forkserver copies the parent's environment once, when it starts, and every child forks
# from it; rayon reads RAYON_NUM_THREADS from that copy. setdefault keeps an operator's value.
FORKSERVER_ENV_DEFAULTS: Final[Mapping[str, str]] = MappingProxyType({"RAYON_NUM_THREADS": "1"})

DEFAULT_PROBE_TIMEOUT_S: Final = 10.0
_PROBE_REAP_TIMEOUT_S: Final = 2.0
# Lets the probe thread notice its own poll timeout before verify() decides the spawn is stuck.
_PROBE_GRACE_S: Final = 0.5
_PROBE_MAX_BYTES: Final = 64 * 1024
DEFAULT_POLL_INTERVAL_S: Final = 0.05
DEFAULT_REAP_TIMEOUT_S: Final = 2.0
DEFAULT_SPAWN_TIMEOUT_S: Final = 10.0
_MIB: Final = 1024 * 1024
_STATUS_OK: Final = "ok"
_STATUS_MISSING: Final = "missing"


@dataclass(frozen=True)
class Readiness:
    ready: bool
    # Module name -> "ok" / "missing". Empty when no probe has answered.
    dependencies: Mapping[str, str] = field(default_factory=dict)
    # The forkserver the probe child was forked from.
    forkserver_pid: int | None = None
    # True when that forkserver has died or been replaced since: only verify() can tell again.
    stale: bool = False


_NOT_READY: Final = Readiness(ready=False)


def _probe_main(result_conn: Connection, module_names: Sequence[str]) -> None:
    # Looks at sys.modules without importing: a module missing here was not preloaded, and
    # importing it now would hide that.
    statuses = {name: _STATUS_OK if name in sys.modules else _STATUS_MISSING for name in module_names}
    result_conn.send_bytes(json.dumps({"forkserverPid": os.getppid(), "dependencies": statuses}).encode())
    result_conn.close()


@dataclass(frozen=True)
class ConversionRequest:
    data: bytes
    filename: str
    mime_hint: str | None


@dataclass(frozen=True)
class _RunLimits:
    limits: ConversionLimits
    timeout_s: float
    max_input_bytes: int


class ConversionRunner:
    def __init__(
        self,
        *,
        limits: ConversionLimits | None = None,
        timeout_s: float | None = None,
        max_input_bytes: int | None = None,
        child_target: ChildTarget = child_main,
        poll_interval_s: float = DEFAULT_POLL_INTERVAL_S,
        reap_timeout_s: float = DEFAULT_REAP_TIMEOUT_S,
        spawn_timeout_s: float = DEFAULT_SPAWN_TIMEOUT_S,
        dependencies: Sequence[str] = CONVERSION_DEPENDENCIES,
        env_defaults: Mapping[str, str] = FORKSERVER_ENV_DEFAULTS,
        probe_timeout_s: float = DEFAULT_PROBE_TIMEOUT_S,
    ) -> None:
        """`timeout_s` is a float separate from Settings.TIMEOUT_S so tests can pass sub-second deadlines.

        The three request limits are optional only so readiness can be used on its own; run()
        refuses to work without them. `child_target` must be a module-level function (it is
        pickled by reference) with child_main's signature.
        """
        all_or_none = (limits, timeout_s, max_input_bytes)
        if any(value is None for value in all_or_none) and any(value is not None for value in all_or_none):
            raise ValueError("limits, timeout_s and max_input_bytes must be given together")
        self._run_limits = (
            None
            if limits is None or timeout_s is None or max_input_bytes is None
            else _RunLimits(limits=limits, timeout_s=timeout_s, max_input_bytes=max_input_bytes)
        )
        self._child_target = child_target
        self._timings = SupervisionTimings(
            poll_interval_s=poll_interval_s, reap_timeout_s=reap_timeout_s, spawn_timeout_s=spawn_timeout_s
        )
        self._dependencies = tuple(dependencies)
        self._env_defaults = dict(env_defaults)
        self._probe_timeout_s = probe_timeout_s
        self._ctx = multiprocessing.get_context("forkserver")
        self._lock = threading.Lock()
        self._verify_lock = threading.Lock()
        self._started = False
        self._last = _NOT_READY
        self._forkserver_pidfd: int | None = None

    @classmethod
    def from_settings(cls, settings: Settings, **options: Any) -> ConversionRunner:  # noqa: ANN401
        """`options` are the remaining keyword arguments of the constructor (timings, child_target, ...)."""
        return cls(
            limits=ConversionLimits.from_settings(settings),
            timeout_s=float(settings.TIMEOUT_S),
            max_input_bytes=settings.MAX_FILE_SIZE_MB * _MIB,
            **options,
        )

    async def run(self, request: ConversionRequest) -> ConversionOutcome:
        """Convert in a fresh child; never raises for anything the child does.

        Preconditions (the caller's job): a concurrency slot is held and the size is checked.
        Postcondition: the child is killed and reaped when this returns, and also when the
        awaiting task is cancelled (the CancelledError propagates). The outcome carries the
        child's peak RSS in `child_peak_rss_mb` (None when it could not be sampled).
        """
        if self._run_limits is None:
            raise RuntimeError("ConversionRunner was built without request limits; use from_settings()")
        params = ChildParams(
            filename=request.filename,
            mime_hint=request.mime_hint,
            limits=self._run_limits.limits,
            timeout_s=self._run_limits.timeout_s,
            max_input_bytes=self._run_limits.max_input_bytes,
        )
        return await run_child(
            self._ctx, self._child_target, request.data, params, self._timings, _kill_standard_forkserver
        )

    async def start(self) -> None:
        """Start the forkserver and wait until it has preloaded the dependencies (lifespan start-up).

        Must run before anything else in the process uses the forkserver context: the preload
        list only applies to a forkserver that has not started yet. Returns within about
        `probe_timeout_s` and never raises for a broken or stuck forkserver or a missing
        dependency; those show up as not ready.
        """
        await asyncio.to_thread(self._start_blocking)

    def _start_blocking(self) -> None:
        with self._lock:
            if self._started:
                return
            for key, value in self._env_defaults.items():
                os.environ.setdefault(key, value)
            self._ctx.set_forkserver_preload(list(self._dependencies))
            self._started = True
        began = time.monotonic()
        readiness = self.verify()
        elapsed_ms = round((time.monotonic() - began) * 1000)
        if readiness.ready:
            logger.info("forkserver started with dependencies preloaded in %d ms", elapsed_ms)
        else:
            logger.error("forkserver is not ready after %d ms: %s", elapsed_ms, dict(readiness.dependencies))

    def stop(self) -> None:
        """Stop the forkserver (lifespan shutdown). Readiness is false from here on.

        Blocks until every child forked from the forkserver has exited, so call it in a thread
        after the running conversions are reaped.
        """
        with self._lock:
            if not self._started:
                return
            self._started = False
            self._last = _NOT_READY
            self._close_pidfd()
        _stop_forkserver()

    def is_ready(self) -> bool:
        return self.readiness().ready

    def readiness(self) -> Readiness:
        """Last verify() result, marked stale if the forkserver it checked is gone.

        Never spawns a process (a spawn would silently restart a dead forkserver) and never
        blocks, so it is safe on the event loop. The forkserver also restarts by itself on the
        next conversion; that new one has not been checked, so it reads as stale too.

        readyz usage: if this is not ready, `await asyncio.to_thread(runner.verify)` and answer
        with that result. Otherwise a pod taken out of service never gets the call that would
        bring it back.
        """
        with self._lock:
            if not self._started:
                return _NOT_READY
            last = self._last
            if last.ready and self._forkserver_changed(last.forkserver_pid):
                return replace(last, ready=False, stale=True)
            return last

    def verify(self) -> Readiness:
        """Fork a probe child through the forkserver and check what it has loaded.

        Restarts a dead forkserver (the standard spawn path does). Returns within about
        `probe_timeout_s`: a forkserver that does not hand out a child in time (frozen, or stuck
        importing a dependency) is killed so the standard spawn path replaces it, and the result
        is not ready. Blocking, so call it with `asyncio.to_thread` from async code.
        """
        with self._lock:
            if not self._started:
                return _NOT_READY
        if not self._verify_lock.acquire(timeout=self._probe_timeout_s + _PROBE_GRACE_S):
            return self.readiness()  # another verify() is still deciding
        try:
            readiness = self._probe_with_deadline()
        finally:
            self._verify_lock.release()
        if not readiness.ready:
            missing = sorted(name for name, status in readiness.dependencies.items() if status != _STATUS_OK)
            logger.warning("forkserver readiness probe failed; not loaded: %s", missing or "probe gave no answer")
        with self._lock:
            if not self._started:
                return _NOT_READY
            self._last = readiness
            self._close_pidfd()
            if readiness.ready and readiness.forkserver_pid is not None:
                self._forkserver_pidfd = _open_pidfd(readiness.forkserver_pid)
            return readiness

    def _probe_with_deadline(self) -> Readiness:
        # Process.start() waits, without any timeout, for the forkserver to report the new
        # child's pid; only a separate thread lets verify() give up on it.
        attempt = _ProbeAttempt(self._ctx, self._dependencies, self._probe_timeout_s)
        thread = threading.Thread(target=attempt.run, name="readiness-probe", daemon=True)
        thread.start()
        thread.join(self._probe_timeout_s + _PROBE_GRACE_S)
        if thread.is_alive() and attempt.spawning:
            logger.error("forkserver did not hand out a probe child in %.1f s; killing it", self._probe_timeout_s)
            _kill_standard_forkserver()
        thread.join(2 * _PROBE_REAP_TIMEOUT_S)
        return attempt.result

    def _forkserver_changed(self, verified_pid: int | None) -> bool:
        if verified_pid is None:
            return True
        pidfd = self._forkserver_pidfd
        if pidfd is not None and _has_exited(pidfd):
            return True
        current = _standard_forkserver_pid()
        if current is not _UNKNOWN and current != verified_pid:
            return True
        return not _pid_alive(verified_pid)

    def _close_pidfd(self) -> None:
        if self._forkserver_pidfd is not None:
            os.close(self._forkserver_pidfd)
            self._forkserver_pidfd = None


class _ProbeAttempt:
    def __init__(self, ctx: multiprocessing.context.ForkServerContext, names: Sequence[str], timeout_s: float) -> None:
        self._ctx = ctx
        self._names = names
        self._timeout_s = timeout_s
        self.spawning = True
        self.result = _NOT_READY

    def run(self) -> None:
        receiver, sender = self._ctx.Pipe(duplex=False)
        process = self._ctx.Process(target=_probe_main, args=(sender, self._names), name="readiness-probe", daemon=True)
        answer: object = None
        try:
            try:
                process.start()
            finally:
                self.spawning = False
                sender.close()
            if receiver.poll(self._timeout_s):
                answer = json.loads(receiver.recv_bytes(_PROBE_MAX_BYTES))
        except Exception as exc:  # noqa: BLE001 - any failure to reach the forkserver means not ready
            logger.warning("forkserver readiness probe could not run: %s", type(exc).__name__)
        finally:
            receiver.close()
            _reap(process, answered=answer is not None)
        self.result = _parse_answer(answer, self._names)


def _parse_answer(answer: object, names: Sequence[str]) -> Readiness:
    if not isinstance(answer, dict):
        return _NOT_READY
    statuses = answer.get("dependencies")
    pid = answer.get("forkserverPid")
    if not isinstance(statuses, dict) or set(statuses) != set(names) or not isinstance(pid, int):
        return _NOT_READY
    if pid in (1, os.getpid()):
        # The probe was re-parented: the forkserver died while it ran.
        return _NOT_READY
    dependencies = {name: str(statuses[name]) for name in names}
    ready = all(status == _STATUS_OK for status in dependencies.values())
    return Readiness(ready=ready, dependencies=MappingProxyType(dependencies), forkserver_pid=pid)


def _reap(process: multiprocessing.process.BaseProcess, *, answered: bool) -> None:
    if process.pid is None:
        return
    if answered:
        process.join(_PROBE_REAP_TIMEOUT_S)
    if process.is_alive():
        process.kill()
        process.join(_PROBE_REAP_TIMEOUT_S)


def _open_pidfd(pid: int) -> int | None:
    # A pidfd is a public, non-reaping liveness handle. It may be missing (non-Linux) or
    # refused (seccomp); readiness() then falls back to the pid comparison.
    if not hasattr(os, "pidfd_open"):
        return None
    try:
        return os.pidfd_open(pid)
    except OSError:
        return None


def _pid_alive(pid: int) -> bool:
    # Weak fallback without a pidfd: a zombie and a reused pid both still look alive.
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        pass
    return True


def _has_exited(pidfd: int) -> bool:
    readable, _, _ = select.select([pidfd], [], [], 0)
    return bool(readable)


_UNKNOWN: Final = object()


def _standard_forkserver_pid() -> object:
    # Read-only peek at multiprocessing's private state: the only way to see that a spawn has
    # silently replaced the forkserver. Treated as unknown if the attribute ever goes away.
    server = getattr(multiprocessing.forkserver, "_forkserver", None)
    return getattr(server, "_forkserver_pid", _UNKNOWN)


def _kill_standard_forkserver() -> None:
    # Unblocks the Process.start() waiting on it (its status pipe hits EOF); the next spawn
    # starts a fresh forkserver.
    pid = _standard_forkserver_pid()
    if not isinstance(pid, int):
        return
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def _stop_forkserver() -> None:
    # multiprocessing has no public way to stop its forkserver; _stop() is the stdlib's own
    # hook. If it ever disappears, the forkserver still exits when this process does.
    stop = getattr(multiprocessing.forkserver._forkserver, "_stop", None)
    if stop is None:
        logger.warning("cannot stop the forkserver on this Python; it exits with the process")
        return
    stop()
