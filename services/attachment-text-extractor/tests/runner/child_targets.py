"""Stand-in child entry points for the runner tests.

They share child_main's signature so ConversionRunner can start them in place of the real entry.
They live outside the test module so a child unpickling them does not import pytest and the
fixtures. Numeric knobs ride in ChildParams.filename because that is the only free-form field.
"""

from __future__ import annotations

import ctypes
import dataclasses
import json
import os
import resource
import select
import signal
import time
from multiprocessing.connection import Connection

from app.conversion.errors import ConversionFailure
from app.conversion.results import ConversionSuccess
from app.runner import child_entry, wire
from app.runner.child_entry import ChildParams
from app.runner.platform_guards import apply_child_guards
from app.schemas import PageInfo

_PARENT_WAIT_S = 30.0


def _no_core() -> None:
    # abort / segfault / SIGXCPU dump core by default; a test must not leave one behind.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _read_input(input_conn: Connection, params: ChildParams) -> bytes:
    with open(input_conn.fileno(), "rb", buffering=0, closefd=False) as stream:
        return wire.read_frame(stream, params.max_input_bytes)


def _write_body(result_conn: Connection, body: bytes) -> None:
    with open(result_conn.fileno(), "wb", buffering=0, closefd=False) as stream:
        wire.write_frame(stream, body)


def _wait_for_parent(liveness_conn: Connection, seconds: float = _PARENT_WAIT_S) -> None:
    # Returns early once the parent closes the liveness pipe, so a stray child never outlives a test.
    select.select([liveness_conn.fileno()], [], [], seconds)


def echo_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    data = _read_input(input_conn, params)
    page = PageInfo(pageNumber=None, label=None, content=f"received {len(data)} bytes")
    _write_body(result_conn, wire.encode_success(ConversionSuccess(pages=[page], mime_type="text/plain")))
    os._exit(0)


def delayed_echo_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    data = _read_input(input_conn, params)
    time.sleep(float(params.filename))
    page = PageInfo(pageNumber=None, label=None, content=f"received {len(data)} bytes")
    _write_body(result_conn, wire.encode_success(ConversionSuccess(pages=[page], mime_type="text/plain")))
    os._exit(0)


def hang_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _read_input(input_conn, params)
    _wait_for_parent(liveness_conn)
    os._exit(0)


def never_read_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _wait_for_parent(liveness_conn)
    os._exit(0)


def exit_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    os._exit(int(params.filename))


def abort_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _no_core()
    _read_input(input_conn, params)
    os.abort()


def segfault_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _no_core()
    _read_input(input_conn, params)
    ctypes.string_at(0)


def sigxcpu_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    # What the kernel sends at the RLIMIT_CPU soft limit; raising it directly keeps the test fast.
    _no_core()
    _read_input(input_conn, params)
    signal.signal(signal.SIGXCPU, signal.SIG_DFL)
    os.kill(os.getpid(), signal.SIGXCPU)
    _wait_for_parent(liveness_conn)


def sigkill_self_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    # Stands in for the kernel OOM killer.
    _read_input(input_conn, params)
    os.kill(os.getpid(), signal.SIGKILL)


def grow_memory_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _read_input(input_conn, params)
    held = []
    for _ in range(int(params.filename)):
        held.append(b"\x01" * (8 * 1024 * 1024))
        time.sleep(0.01)
    _wait_for_parent(liveness_conn)
    os._exit(0)


def oversize_header_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _read_input(input_conn, params)
    os.write(result_conn.fileno(), wire.encode_frame_header(wire.MAX_FRAME_LENGTH))
    _wait_for_parent(liveness_conn)
    os._exit(0)


def partial_body_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _read_input(input_conn, params)
    os.write(result_conn.fileno(), wire.encode_frame_header(1000) + b"{" * 10)
    _wait_for_parent(liveness_conn)
    os._exit(0)


def truncated_body_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _read_input(input_conn, params)
    os.write(result_conn.fileno(), wire.encode_frame_header(1000) + b"{" * 10)
    os._exit(0)


def garbage_result_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _read_input(input_conn, params)
    _write_body(result_conn, b"this is not json")
    os._exit(0)


def parent_kind_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    # A hijacked child claiming a kind only the parent may decide.
    _read_input(input_conn, params)
    _write_body(result_conn, wire.encode_failure(ConversionFailure(kind="timeout", detail="forged")))
    os._exit(0)


def report_pid_then_hang_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    with open(params.filename, "w") as f:
        f.write(str(os.getpid()))
    _read_input(input_conn, params)
    _wait_for_parent(liveness_conn)
    os._exit(0)


def params_echo_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    _read_input(input_conn, params)
    content = json.dumps(
        {"timeout_s": params.timeout_s, "max_input_bytes": params.max_input_bytes, **dataclasses.asdict(params.limits)}
    )
    page = PageInfo(pageNumber=None, label=None, content=content)
    _write_body(result_conn, wire.encode_success(ConversionSuccess(pages=[page], mime_type="application/json")))
    os._exit(0)


def result_then_stuck_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    # Stands in for a native destructor that never returns: ignores the liveness pipe on purpose.
    _read_input(input_conn, params)
    page = PageInfo(pageNumber=None, label=None, content="done")
    _write_body(result_conn, wire.encode_success(ConversionSuccess(pages=[page], mime_type="text/plain")))
    time.sleep(_PARENT_WAIT_S)
    os._exit(0)


# --- the real child_main with one part replaced inside the child ---------------------------
# The replacement must happen in the child: forkserver children do not inherit the test
# process's monkeypatches.


class PanicException(BaseException):  # noqa: N818 - mirrors pyo3's name
    """Stand-in for pyo3_runtime.PanicException, which derives from BaseException."""


PanicException.__module__ = "pyo3_runtime"


def _panic(*_args: object) -> None:
    raise PanicException("index out of bounds: the len is 3 but the index is 7")


def panic_in_convert_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    child_entry.convert = _panic
    child_entry.child_main(input_conn, result_conn, liveness_conn, params)


def convert_forever_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    # Keeps the child inside real conversion work for as long as the test needs it.
    real_convert = child_entry.convert

    def again(*args: object) -> None:
        while True:
            real_convert(*args)

    child_entry.convert = again
    child_entry.child_main(input_conn, result_conn, liveness_conn, params)


def crash_or_convert_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    if params.filename == "abort":
        abort_target(input_conn, result_conn, liveness_conn, params)
    elif params.filename == "segfault":
        segfault_target(input_conn, result_conn, liveness_conn, params)
    else:
        child_entry.child_main(input_conn, result_conn, liveness_conn, params)


def cpu_overrun_target(
    input_conn: Connection, result_conn: Connection, liveness_conn: Connection, params: ChildParams
) -> None:
    # The production soft limit is at least 6 s; lowering only the soft limit (after the real
    # guards set the signal disposition and the hard limit) lets the kernel send SIGXCPU after 1 s.
    apply_child_guards(params.limits.max_child_rss_mb, params.timeout_s)
    _, hard = resource.getrlimit(resource.RLIMIT_CPU)
    resource.setrlimit(resource.RLIMIT_CPU, (1, hard))
    _read_input(input_conn, params)
    while True:
        pass
