"""One conversion per child: supervision, classification and clean-up (design: ConversionRunner; Req 2.2, 2.5-2.7)."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import multiprocessing
import multiprocessing.context
import multiprocessing.forkserver
import multiprocessing.process
import os
import signal
import sys
import tempfile
import threading
import time
from collections.abc import Awaitable, Callable
from dataclasses import replace
from pathlib import Path

import child_targets
import pytest

from app.conversion.errors import ConversionFailure
from app.conversion.limits import ConversionLimits
from app.conversion.results import ConversionSuccess
from app.runner.child_supervision import classify_exit, parse_status_memory_kib
from app.runner.conversion_runner import ConversionRequest, ConversionRunner
from fixture_files import make_docx, make_text_pdf

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(not sys.platform.startswith("linux"), reason="supervision relies on /proc"),
]

MIB = 1024 * 1024
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
LIMITS = ConversionLimits(
    max_child_rss_mb=320,
    max_result_bytes=16 * MIB,
    max_pdf_pages=5000,
    max_archive_entries=10_000,
    max_archive_uncompressed_mb=512,
    max_xlsx_cells=100_000,
    ipynb_output_max_chars=10_000,
)
# Every awaited run() is wrapped in this so a supervision bug fails the test instead of hanging it.
RUN_GUARD_S = 20.0

RunnerFactory = Callable[..., Awaitable[ConversionRunner]]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def make_runner(isolated_forkserver: None) -> RunnerFactory:
    async def build(**overrides: object) -> ConversionRunner:
        options: dict[str, object] = {"limits": LIMITS, "timeout_s": 20.0, "max_input_bytes": 60 * MIB}
        options.update(overrides)
        runner = ConversionRunner(**options)
        await runner.start()
        assert runner.is_ready()
        return runner

    return build


async def _run(runner: ConversionRunner, data: bytes, filename: str, mime_hint: str | None = None):
    return await asyncio.wait_for(runner.run(ConversionRequest(data, filename, mime_hint)), RUN_GUARD_S)


def _forkserver_children() -> set[int]:
    pid = multiprocessing.forkserver._forkserver._forkserver_pid
    if pid is None:
        return set()
    children: set[int] = set()
    for task in Path(f"/proc/{pid}/task").iterdir():
        children.update(int(c) for c in (task / "children").read_text().split())
    return children


def _fd_count() -> int:
    return len(os.listdir("/proc/self/fd"))


def _assert_nothing_left() -> None:
    assert multiprocessing.active_children() == []
    assert _forkserver_children() == set()


# --- success -----------------------------------------------------------------


async def test_pdf_conversion_returns_pages_and_the_child_peak_rss(make_runner: RunnerFactory):
    runner = await make_runner()
    outcome = await _run(runner, make_text_pdf(["first page", "second page"]), "doc.pdf", "application/pdf")

    assert isinstance(outcome, ConversionSuccess)
    assert [page.content for page in outcome.pages] == ["first page", "second page"]
    assert outcome.mime_type == "application/pdf"
    assert outcome.child_peak_rss_mb is not None and outcome.child_peak_rss_mb > 0
    _assert_nothing_left()


async def test_docx_conversion_returns_the_text_and_leaves_no_child(make_runner: RunnerFactory):
    runner = await make_runner()
    outcome = await _run(runner, make_docx("社内規程の改定について"), "memo.docx", DOCX_MIME)

    assert isinstance(outcome, ConversionSuccess)
    assert "社内規程の改定について" in outcome.pages[0].content
    assert outcome.child_peak_rss_mb is not None and outcome.child_peak_rss_mb > 0
    _assert_nothing_left()


async def test_a_child_that_keeps_running_after_its_result_is_killed_and_reaped(make_runner: RunnerFactory):
    runner = await make_runner(child_target=child_targets.result_then_stuck_target)
    began = time.monotonic()
    outcome = await _run(runner, b"x", "ignored")

    assert isinstance(outcome, ConversionSuccess)
    assert outcome.pages[0].content == "done"
    assert time.monotonic() - began < 2.0
    _assert_nothing_left()


async def test_concurrent_runs_all_succeed(make_runner: RunnerFactory):
    runner = await make_runner()
    outcomes = await asyncio.gather(
        *(_run(runner, make_text_pdf([f"page {i}"]), f"{i}.pdf", "application/pdf") for i in range(4))
    )

    assert [o.pages[0].content for o in outcomes if isinstance(o, ConversionSuccess)] == [f"page {i}" for i in range(4)]
    _assert_nothing_left()


# --- failures the child reports ------------------------------------------------


async def test_a_corrupt_pdf_passes_the_childs_malformed_through(make_runner: RunnerFactory):
    runner = await make_runner()
    outcome = await _run(runner, b"%PDF-1.4\nthis is not a pdf", "broken.pdf", "application/pdf")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "malformed"
    _assert_nothing_left()


async def test_a_result_over_the_limit_reported_by_the_child_passes_through(make_runner: RunnerFactory):
    runner = await make_runner(limits=replace(LIMITS, max_result_bytes=64))
    outcome = await _run(runner, ("長い本文 " * 1000).encode(), "long.txt", "text/plain")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "result_too_large"


# --- failures the parent decides -----------------------------------------------


async def test_a_child_past_the_deadline_is_killed_as_timeout(make_runner: RunnerFactory):
    runner = await make_runner(timeout_s=0.3, child_target=child_targets.hang_target)
    began = time.monotonic()
    outcome = await _run(runner, b"x", "ignored")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "timeout"
    assert time.monotonic() - began < 2.0
    _assert_nothing_left()


async def test_a_child_sending_its_result_slowly_still_hits_the_deadline(make_runner: RunnerFactory):
    runner = await make_runner(timeout_s=0.3, child_target=child_targets.partial_body_target)
    outcome = await _run(runner, b"x", "ignored")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "timeout"
    _assert_nothing_left()


async def test_a_child_that_never_reads_its_input_still_hits_the_deadline(make_runner: RunnerFactory):
    runner = await make_runner(timeout_s=0.3, child_target=child_targets.never_read_target)
    outcome = await _run(runner, b"\0" * (8 * MIB), "ignored")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "timeout"
    _assert_nothing_left()


async def test_a_child_over_the_rss_limit_is_killed_as_memory_exceeded(make_runner: RunnerFactory):
    runner = await make_runner(
        limits=replace(LIMITS, max_child_rss_mb=96), child_target=child_targets.grow_memory_target
    )
    outcome = await _run(runner, b"x", "40")  # 40 x 8 MiB, far past 96 MB

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "memory_exceeded"
    assert outcome.child_peak_rss_mb is not None and outcome.child_peak_rss_mb > 96
    _assert_nothing_left()


async def test_a_result_frame_over_the_limit_is_discarded_as_result_too_large(make_runner: RunnerFactory):
    runner = await make_runner(child_target=child_targets.oversize_header_target)
    began = time.monotonic()
    outcome = await _run(runner, b"x", "ignored")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "result_too_large"
    assert time.monotonic() - began < 5.0
    _assert_nothing_left()


# --- a child that ends without a result -----------------------------------------


@pytest.mark.parametrize(
    "target",
    [
        child_targets.abort_target,
        child_targets.segfault_target,
        child_targets.sigkill_self_target,
        child_targets.truncated_body_target,
    ],
    ids=["abort", "segfault", "sigkill", "truncated-frame"],
)
async def test_a_child_dying_without_a_result_is_crashed(make_runner: RunnerFactory, target):
    runner = await make_runner(child_target=target)
    outcome = await _run(runner, b"x", "ignored")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "crashed"
    _assert_nothing_left()


@pytest.mark.parametrize("code", ["0", "1", "3", "4"])
async def test_a_child_exiting_without_a_result_is_crashed_whatever_its_code(make_runner: RunnerFactory, code: str):
    runner = await make_runner(child_target=child_targets.exit_target)
    outcome = await _run(runner, b"\0" * (4 * MIB), code)

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "crashed"
    _assert_nothing_left()


@pytest.mark.parametrize(
    "target", [child_targets.garbage_result_target, child_targets.parent_kind_target], ids=["not-json", "forged-kind"]
)
async def test_a_result_that_breaks_the_protocol_is_crashed(make_runner: RunnerFactory, target):
    runner = await make_runner(child_target=target)
    outcome = await _run(runner, b"x", "ignored")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "crashed"


async def test_a_child_ended_by_sigxcpu_is_timeout(make_runner: RunnerFactory):
    runner = await make_runner(child_target=child_targets.sigxcpu_target)
    outcome = await _run(runner, b"x", "ignored")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "timeout"
    _assert_nothing_left()


async def test_a_child_that_cannot_be_started_is_crashed(make_runner: RunnerFactory):
    runner = await make_runner(spawn_timeout_s=0.5)
    frozen = multiprocessing.forkserver._forkserver._forkserver_pid
    os.kill(frozen, signal.SIGSTOP)
    try:
        began = time.monotonic()
        outcome = await _run(runner, make_text_pdf(["x"]), "doc.pdf", "application/pdf")
        assert time.monotonic() - began < 5.0
    finally:
        try:
            os.kill(frozen, signal.SIGCONT)
        except ProcessLookupError:
            pass

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "crashed"
    # The next request gets a fresh forkserver.
    after = await _run(runner, make_text_pdf(["again"]), "doc.pdf", "application/pdf")
    assert isinstance(after, ConversionSuccess)


# --- cancellation, event loop, leaks ---------------------------------------------


async def test_cancelling_run_kills_and_reaps_the_child(make_runner: RunnerFactory, tmp_path: Path):
    runner = await make_runner(child_target=child_targets.report_pid_then_hang_target)
    pid_file = tmp_path / "pid"
    task = asyncio.ensure_future(runner.run(ConversionRequest(b"x", str(pid_file), None)))
    deadline = time.monotonic() + RUN_GUARD_S
    while not pid_file.exists() or not pid_file.read_text():
        assert time.monotonic() < deadline
        await asyncio.sleep(0.02)
    child_pid = int(pid_file.read_text())

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, RUN_GUARD_S)

    assert not Path(f"/proc/{child_pid}").exists()
    _assert_nothing_left()


async def test_supervising_a_slow_child_with_a_large_input_keeps_the_event_loop_responsive(
    make_runner: RunnerFactory,
):
    runner = await make_runner(child_target=child_targets.delayed_echo_target)
    gaps: list[float] = []
    stop = asyncio.Event()

    async def ticker() -> None:
        last = time.monotonic()
        while not stop.is_set():
            await asyncio.sleep(0.01)
            now = time.monotonic()
            gaps.append(now - last)
            last = now

    ticking = asyncio.ensure_future(ticker())
    try:
        outcome = await _run(runner, b"\xab" * (50 * MIB), "1.0")
    finally:
        stop.set()
        await ticking

    assert isinstance(outcome, ConversionSuccess)
    assert outcome.pages[0].content == f"received {50 * MIB} bytes"
    assert max(gaps) < 0.1


async def test_two_hundred_sequential_runs_leak_no_fds_threads_or_children(make_runner: RunnerFactory):
    runner = await make_runner(child_target=child_targets.echo_target)
    for _ in range(5):  # warm up executor threads and lazily opened descriptors
        await _run(runner, b"warm", "ignored")
    fds, threads = _fd_count(), threading.active_count()

    for i in range(200):
        outcome = await _run(runner, b"x" * i, "ignored")
        assert isinstance(outcome, ConversionSuccess)

    assert _fd_count() == fds
    assert threading.active_count() <= threads
    _assert_nothing_left()


async def test_a_killed_conversion_leaves_no_temporary_files(make_runner: RunnerFactory, xlsx_large_for_timeout_path):
    runner = await make_runner(timeout_s=0.2)
    idle = await _run(runner, b"hello", "a.txt")
    before = set(os.listdir(tempfile.gettempdir()))
    outcome = await _run(runner, xlsx_large_for_timeout_path.read_bytes(), "big.xlsx")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "timeout"
    # Clearly above a near-idle child: the conversion was under way when the child was killed.
    assert outcome.child_peak_rss_mb is not None and idle.child_peak_rss_mb is not None
    assert outcome.child_peak_rss_mb > idle.child_peak_rss_mb + 8
    assert set(os.listdir(tempfile.gettempdir())) - before == set()
    _assert_nothing_left()


async def test_a_start_that_hits_a_just_died_forkserver_is_crashed(
    make_runner: RunnerFactory, monkeypatch: pytest.MonkeyPatch
):
    # What Process.start() raises when the forkserver died before the stdlib noticed (6.2 note).
    runner = await make_runner()
    fds = _fd_count()

    def start_into_dead_forkserver(self: multiprocessing.process.BaseProcess) -> None:
        raise EOFError("unexpected EOF")

    with monkeypatch.context() as patch:
        patch.setattr(multiprocessing.context.ForkServerProcess, "start", start_into_dead_forkserver)
        outcome = await _run(runner, b"x", "doc.pdf")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "crashed"
    assert outcome.child_peak_rss_mb is None
    assert _fd_count() == fds


async def test_cancelling_while_the_child_is_being_started_leaves_nothing_behind(make_runner: RunnerFactory):
    runner = await make_runner(spawn_timeout_s=1.0)
    fds = _fd_count()
    frozen = multiprocessing.forkserver._forkserver._forkserver_pid
    os.kill(frozen, signal.SIGSTOP)
    try:
        task = asyncio.ensure_future(runner.run(ConversionRequest(b"x", "doc.pdf", None)))
        await asyncio.sleep(0.2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, RUN_GUARD_S)
    finally:
        try:
            os.kill(frozen, signal.SIGCONT)
        except ProcessLookupError:
            pass
    # Give a start() that was still in flight the chance to produce a late, unsupervised child.
    await asyncio.sleep(0.3)
    assert _fd_count() == fds
    _assert_nothing_left()


# --- construction --------------------------------------------------------------


async def test_from_settings_hands_the_settings_limits_to_the_child(isolated_forkserver: None):
    from app.config import Settings

    settings = Settings(TIMEOUT_S=7, MAX_FILE_SIZE_MB=3, MAX_CHILD_RSS_MB=111)
    runner = ConversionRunner.from_settings(settings, child_target=child_targets.params_echo_target)
    await runner.start()
    outcome = await _run(runner, b"x", "ignored")

    assert isinstance(outcome, ConversionSuccess)
    seen = json.loads(outcome.pages[0].content)
    assert seen == {
        "timeout_s": 7.0,
        "max_input_bytes": 3 * MIB,
        **dataclasses.asdict(ConversionLimits.from_settings(settings)),
    }


def test_partial_request_limits_are_rejected():
    with pytest.raises(ValueError):
        ConversionRunner(limits=LIMITS)


async def test_run_without_request_limits_is_refused():
    with pytest.raises(RuntimeError):
        await ConversionRunner().run(ConversionRequest(b"x", "a.txt", None))


# --- pure helpers --------------------------------------------------------------


@pytest.mark.parametrize(
    ("exitcode", "kind"),
    [
        (-signal.SIGXCPU, "timeout"),
        (-signal.SIGABRT, "crashed"),
        (-signal.SIGKILL, "crashed"),
        (0, "crashed"),
        (3, "crashed"),
        (4, "crashed"),
        (None, "crashed"),
    ],
)
def test_classify_exit(exitcode: int | None, kind: str):
    assert classify_exit(exitcode).kind == kind


def test_parse_status_memory_reads_rss_and_high_water_mark():
    status = "Name:\tpython\nVmHWM:\t  41000 kB\nVmRSS:\t   39000 kB\nThreads:\t1\n"
    assert parse_status_memory_kib(status) == (39000, 41000)
    assert parse_status_memory_kib("Name:\tpython\nState:\tZ (zombie)\n") == (None, None)
