"""Child process entry: guards, parent-liveness watch, conversion, single JSON result (Req 2.5, 2.6, 2.7)."""

from __future__ import annotations

import io
import json
import multiprocessing
import os
import select
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from multiprocessing.connection import Connection

import pytest

from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits
from app.conversion.results import ConversionSuccess
from app.runner import child_entry, wire
from app.runner.child_entry import ChildParams
from app.schemas import PageInfo
from fixture_files import make_docx, make_text_pdf

MIB = 1024 * 1024
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
SECRET = "SECRET-FILE-BYTES-7f3a"

# Production defaults: the success cases also prove the guards do not break a normal conversion.
DEFAULT_LIMITS = ConversionLimits(
    max_child_rss_mb=320,
    max_result_bytes=16 * MIB,
    max_pdf_pages=5000,
    max_archive_entries=10_000,
    max_archive_uncompressed_mb=512,
    max_xlsx_cells=70_000,
    ipynb_output_max_chars=10_000,
    max_csv_bytes=8 * 1024 * 1024,
    max_html_bytes=20 * 1024 * 1024,
)


def _params(filename: str, mime_hint: str | None = None, **overrides: object) -> ChildParams:
    base = ChildParams(
        filename=filename,
        mime_hint=mime_hint,
        limits=DEFAULT_LIMITS,
        timeout_s=55.0,
        max_input_bytes=50 * MIB,
    )
    return replace(base, **overrides)


# --- in-process: failure classification and encoding ------------------------


def _run_with(monkeypatch: pytest.MonkeyPatch, outcome: BaseException | ConversionSuccess, **params: object) -> dict:
    def fake_convert(*_args: object) -> ConversionSuccess:
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    monkeypatch.setattr(child_entry, "convert", fake_convert)
    body = child_entry.run_conversion(b"data", _params("a.txt", **params))
    wire.decode_result(body)  # whatever the child sends must satisfy the parent's decoder
    return json.loads(body)


def test_conversion_error_is_sent_as_its_kind_and_detail(monkeypatch: pytest.MonkeyPatch):
    result = _run_with(monkeypatch, ConversionError("encrypted", "document is password protected"))
    assert result == {"ok": False, "kind": "encrypted", "detail": "document is password protected"}


def test_kind_outside_what_the_child_may_report_becomes_internal(monkeypatch: pytest.MonkeyPatch):
    result = _run_with(monkeypatch, ConversionError("timeout", "x"))
    assert result["kind"] == "internal"


def test_overlong_detail_is_truncated_to_what_the_parent_accepts(monkeypatch: pytest.MonkeyPatch):
    result = _run_with(monkeypatch, ConversionError("malformed", "d" * 5000))
    assert result == {"ok": False, "kind": "malformed", "detail": "d" * wire.MAX_DETAIL_CHARS}


def _chained_error() -> RuntimeError:
    try:
        raise ValueError(SECRET)
    except ValueError:
        try:
            raise RuntimeError(SECRET)  # noqa: B904 - the implicit __context__ chain is the point
        except RuntimeError as exc:
            return exc


class FakePanicException(BaseException):
    """Stands in for pyo3's PanicException, which derives from BaseException."""


@pytest.mark.parametrize(
    ("error", "class_name"),
    [
        pytest.param(_chained_error(), "RuntimeError", id="exception-with-context"),
        pytest.param(FakePanicException(SECRET), "FakePanicException", id="panic-like-base-exception"),
        pytest.param(MemoryError(SECRET), "MemoryError", id="memory-error"),
    ],
)
def test_unexpected_errors_become_internal_with_only_the_class_name(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, error: BaseException, class_name: str
):
    caplog.set_level("DEBUG")
    result = _run_with(monkeypatch, error)
    assert result == {"ok": False, "kind": "internal", "detail": class_name}
    assert SECRET not in caplog.text


@pytest.mark.parametrize("error", [SystemExit(3), KeyboardInterrupt()])
def test_exit_requests_are_re_raised(monkeypatch: pytest.MonkeyPatch, error: BaseException):
    monkeypatch.setattr(child_entry, "convert", lambda *_: (_ for _ in ()).throw(error))
    with pytest.raises(type(error)):
        child_entry.run_conversion(b"data", _params("a.txt"))


def test_unencodable_text_becomes_internal(monkeypatch: pytest.MonkeyPatch):
    success = ConversionSuccess(
        pages=[PageInfo(pageNumber=None, label=None, content="a\ud800")], mime_type="text/plain"
    )
    assert _run_with(monkeypatch, success)["kind"] == "internal"


def test_result_frame_over_the_ceiling_becomes_result_too_large(monkeypatch: pytest.MonkeyPatch):
    # Control characters escape to 6 bytes each, so the frame outgrows 2x the content limit.
    limits = replace(DEFAULT_LIMITS, max_result_bytes=1024)
    content = "\x01" * (wire.max_result_frame_bytes(1024) // 6 + 1)
    success = ConversionSuccess(pages=[PageInfo(pageNumber=None, label=None, content=content)], mime_type="text/plain")
    assert _run_with(monkeypatch, success, limits=limits)["kind"] == "result_too_large"


# --- real process boundary --------------------------------------------------


@dataclass
class _Child:
    process: multiprocessing.process.BaseProcess
    input_writer: Connection
    result_reader: Connection
    liveness_writer: Connection

    def send_input(self, data: bytes) -> None:
        with open(self.input_writer.fileno(), "wb", buffering=0, closefd=False) as stream:
            wire.write_frame(stream, data)

    def send_raw(self, raw: bytes) -> None:
        os.write(self.input_writer.fileno(), raw)

    def read_until_eof(self, timeout: float = 30.0) -> bytes:
        fd = self.result_reader.fileno()
        deadline = time.monotonic() + timeout
        received = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            assert remaining > 0, "child did not close its result pipe in time"
            ready, _, _ = select.select([fd], [], [], remaining)
            if ready:
                chunk = os.read(fd, 65536)
                if not chunk:
                    return bytes(received)
                received += chunk

    def wait_exit(self, timeout: float) -> int | None:
        self.process.join(timeout)
        return self.process.exitcode


@contextmanager
def _started_child(params: ChildParams) -> Iterator[_Child]:
    ctx = multiprocessing.get_context("forkserver")
    input_reader, input_writer = ctx.Pipe(duplex=False)
    result_reader, result_writer = ctx.Pipe(duplex=False)
    liveness_reader, liveness_writer = ctx.Pipe(duplex=False)
    process = ctx.Process(
        target=child_entry.child_main,
        args=(input_reader, result_writer, liveness_reader, params),
        name="child_main-test",
    )
    process.start()
    # Drop the parent's copies of the child's ends; otherwise EOF never reaches either side.
    for conn in (input_reader, result_writer, liveness_reader):
        conn.close()
    child = _Child(process, input_writer, result_reader, liveness_writer)
    try:
        yield child
    finally:
        for conn in (input_writer, result_reader, liveness_writer):
            conn.close()
        if process.is_alive():
            process.kill()
        process.join(5)


def _single_result(raw: bytes, params: ChildParams) -> dict:
    """The child sends exactly one frame and then closes: nothing may follow it."""
    stream = io.BytesIO(raw)
    body = wire.read_frame(stream, wire.max_result_frame_bytes(params.limits.max_result_bytes))
    assert stream.read() == b"", "data after the single result frame"
    wire.decode_result(body)
    return json.loads(body)


@pytest.mark.parametrize(
    ("data", "params", "expected_text"),
    [
        pytest.param(make_text_pdf(["Hello runner"]), _params("a.pdf"), "Hello runner", id="pdf"),
        pytest.param(make_docx("段落の本文です"), _params("a.docx", DOCX_MIME), "段落の本文です", id="docx-anydoc"),
    ],
)
def test_good_file_returns_a_success_json_then_the_child_exits(data: bytes, params: ChildParams, expected_text: str):
    with _started_child(params) as child:
        child.send_input(data)
        result = _single_result(child.read_until_eof(), params)
        assert child.wait_exit(10) == 0

    assert result["ok"] is True
    assert expected_text in "".join(page["content"] for page in result["pages"])


def test_corrupt_file_returns_a_failure_json():
    params = _params("broken.pdf", "application/pdf")
    with _started_child(params) as child:
        child.send_input(b"%PDF-1.7\n" + b"\x00garbage" * 100)
        result = _single_result(child.read_until_eof(), params)
        assert child.wait_exit(10) == 0

    assert result == {"ok": False, "kind": "malformed", "detail": result["detail"]}
    assert "garbage" not in result["detail"]


def test_absurd_length_header_is_rejected_without_a_result():
    params = _params("a.pdf", max_input_bytes=1 * MIB)
    with _started_child(params) as child:
        child.send_raw(b"\xff\xff\xff\xff")
        assert child.read_until_eof(timeout=10) == b""
        assert child.wait_exit(10) == child_entry.BAD_INPUT_EXIT_CODE


def test_input_cut_short_is_rejected_without_a_result():
    params = _params("a.pdf")
    with _started_child(params) as child:
        child.send_raw(wire.encode_frame_header(1000) + b"x" * 10)
        child.input_writer.close()
        assert child.read_until_eof(timeout=10) == b""
        assert child.wait_exit(10) == child_entry.BAD_INPUT_EXIT_CODE


def test_child_exits_within_2s_once_the_requesting_worker_drops_the_liveness_pipe():
    # The input pipe stays open, so the child's main thread is blocked reading it.
    # The exit can only come from the watcher, and only if the child holds no copy of the write end.
    with _started_child(_params("a.pdf")) as child:
        # Wait until child_main is running (guards come right before the watcher) so slow
        # imports in the child are not counted against the 2s budget.
        _wait_until_guarded(child.process.pid)
        assert child.process.is_alive()
        started = time.monotonic()
        child.liveness_writer.close()
        exitcode = child.wait_exit(2.0)
        elapsed = time.monotonic() - started

    assert exitcode == child_entry.PARENT_GONE_EXIT_CODE
    assert elapsed < 2.0


def _proc_text(pid: int, name: str) -> str:
    with open(f"/proc/{pid}/{name}") as f:
        return f.read()


def _wait_until_guarded(pid: int, timeout: float = 10.0) -> None:
    if sys.platform != "linux":
        time.sleep(1.0)
        return
    deadline = time.monotonic() + timeout
    while _proc_text(pid, "oom_score_adj").strip() != "1000":
        assert time.monotonic() < deadline, "oom_score_adj was never raised"
        time.sleep(0.02)


def _limit_row(limits_text: str, name: str) -> tuple[str, str]:
    row = next(line for line in limits_text.splitlines() if line.startswith(name))
    soft, hard = row[len(name) :].split()[:2]
    return soft, hard


@pytest.mark.skipif(sys.platform != "linux", reason="RLIMIT_AS / oom_score_adj are Linux-only")
def test_guards_are_set_in_the_running_child_before_it_reads_the_file():
    params = _params("a.pdf", timeout_s=0.4)
    with _started_child(params) as child:
        pid = child.process.pid
        _wait_until_guarded(pid)
        limits_text = _proc_text(pid, "limits")

        child.send_input(make_text_pdf(["after the guards"]))
        result = _single_result(child.read_until_eof(), params)

    expected_as = str((320 + 512) * MIB)
    assert _limit_row(limits_text, "Max address space") == (expected_as, expected_as)
    # ceil(0.4) + 5 = 6 soft; hard stays 5s above so SIGXCPU arrives first.
    assert _limit_row(limits_text, "Max cpu time") == ("6", "11")
    assert _limit_row(limits_text, "Max core file size") == ("0", "0")
    assert result["ok"] is True
