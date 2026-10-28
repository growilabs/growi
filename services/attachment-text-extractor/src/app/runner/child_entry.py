"""Entry point of the per-request conversion child (design: ChildEntry; Req 2.5, 2.6, 2.7).

The parent starts `child_main` through the forkserver context and passes it three one-way
pipes: the file frame to read, the result frame to write, and a liveness pipe whose write end
only the requesting worker holds. Because a forkserver child inherits nothing but the
descriptors passed as arguments, the child never holds that write end, so it sees EOF as soon
as the worker closes it or dies.
"""

from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from multiprocessing.connection import Connection
from typing import Final

from app.conversion import convert
from app.conversion.errors import ConversionError, ConversionFailure
from app.conversion.limits import ConversionLimits
from app.runner import wire
from app.runner.platform_guards import apply_child_guards

logger = logging.getLogger(__name__)

# Exit codes the parent can tell apart from a normal exit (0) and from death by signal.
PARENT_GONE_EXIT_CODE: Final = 3
BAD_INPUT_EXIT_CODE: Final = 4


@dataclass(frozen=True)
class ChildParams:
    filename: str
    mime_hint: str | None
    limits: ConversionLimits
    timeout_s: float  # The parent's deadline; RLIMIT_CPU is derived from it.
    max_input_bytes: int  # MAX_FILE_SIZE: an input frame header above it is rejected before allocating.


def child_main(input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams) -> None:
    apply_child_guards(params.limits.max_child_rss_mb, params.timeout_s)
    _start_liveness_watcher(liveness_conn.fileno())

    try:
        with open(input_conn.fileno(), "rb", buffering=0, closefd=False) as stream:
            data = wire.read_frame(stream, params.max_input_bytes)
    except wire.WireProtocolError:
        # The parent sent a broken frame or went away; no result, so it sees an abnormal exit.
        logger.warning("conversion child received an invalid input frame")
        os._exit(BAD_INPUT_EXIT_CODE)
    input_conn.close()

    body = run_conversion(data, params)
    del data
    try:
        with open(result_conn.fileno(), "wb", buffering=0, closefd=False) as stream:
            wire.write_frame(stream, body)
    except OSError:
        logger.warning("conversion child could not send its result")
    result_conn.close()
    # Skip interpreter teardown: nothing is left to flush and a stuck native destructor must not delay exit.
    os._exit(0)


def run_conversion(data: bytes, params: ChildParams) -> bytes:
    """Convert and encode the single result frame body.

    Only kind + a fixed detail (or a class name) ever leave the child: exception messages and
    their `__context__` chain can quote input bytes.
    """
    try:
        success = convert(data, params.filename, params.mime_hint, params.limits)
    except (SystemExit, KeyboardInterrupt):
        raise
    except ConversionError as exc:
        return _failure(exc)
    except BaseException as exc:  # noqa: BLE001 - Rust panics arrive as BaseException (PanicException)
        return _internal(type(exc).__name__)

    try:
        body = wire.encode_success(success)
    except UnicodeEncodeError:
        return _internal("result text cannot be encoded as UTF-8")
    except MemoryError:
        return _internal("MemoryError")
    del success
    if len(body) > wire.max_result_frame_bytes(params.limits.max_result_bytes):
        return wire.encode_failure(
            ConversionFailure(kind="result_too_large", detail="encoded result exceeds the limit")
        )
    return body


def _failure(exc: ConversionError) -> bytes:
    # Keep the child to the same contract the parent's decoder enforces, so a legitimate
    # failure is never turned into a "malformed result" crash by the parent.
    if exc.kind not in wire.CHILD_REPORTABLE_KINDS:
        return _internal(f"unexpected failure kind {exc.kind}"[: wire.MAX_DETAIL_CHARS])
    return wire.encode_failure(ConversionFailure(kind=exc.kind, detail=exc.detail[: wire.MAX_DETAIL_CHARS]))


def _internal(detail: str) -> bytes:
    logger.warning("conversion child failed unexpectedly: %s", detail)
    return wire.encode_failure(ConversionFailure(kind="internal", detail=detail))


def _start_liveness_watcher(fd: int) -> None:
    # os._exit, not an exception: the main thread may be inside native code that never returns to Python.
    def watch() -> None:
        try:
            while os.read(fd, 1):
                pass
        except OSError:
            pass
        os._exit(PARENT_GONE_EXIT_CODE)

    threading.Thread(target=watch, name="parent-liveness", daemon=True).start()
