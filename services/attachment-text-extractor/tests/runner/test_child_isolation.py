"""How a conversion child is stopped and isolated, with real conversions (design: Runner Tests; Req 2.2, 2.5-2.7, 4.2).

test_conversion_runner covers each classification path with stand-in children; this file checks
the same guarantees end to end: real files, the real child entry, the production limits.
"""

from __future__ import annotations

import asyncio
import io
import multiprocessing
import multiprocessing.forkserver
import os
import select
import signal
import subprocess
import sys
import time
import zipfile
from collections.abc import Awaitable, Callable
from dataclasses import replace
from pathlib import Path

import child_targets
import openpyxl
import pytest

from app.config import Settings
from app.conversion.errors import ConversionFailure
from app.conversion.limits import ConversionLimits
from app.conversion.results import ConversionOutcome, ConversionSuccess
from app.runner.conversion_runner import ConversionRequest, ConversionRunner
from app.runner.platform_guards import address_space_limit_bytes
from fixture_files import _build_pdf, _random_images, make_docx, make_text_pdf, write_xlsx_cells

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(not sys.platform.startswith("linux"), reason="supervision relies on /proc"),
]

MIB = 1024 * 1024
RUN_GUARD_S = 30.0
WAIT_S = 10.0
WORKER = Path(__file__).with_name("isolation_worker.py")

RunnerFactory = Callable[..., Awaitable[ConversionRunner]]


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def default_settings() -> Settings:
    return Settings()


@pytest.fixture
async def make_runner(isolated_forkserver: None, default_settings: Settings) -> RunnerFactory:
    """Runners built from the real Settings defaults; keyword overrides replace single options."""

    async def build(**overrides: object) -> ConversionRunner:
        runner = ConversionRunner.from_settings(default_settings)
        if overrides:
            options: dict[str, object] = {
                "limits": ConversionLimits.from_settings(default_settings),
                "timeout_s": float(default_settings.TIMEOUT_S),
                "max_input_bytes": default_settings.MAX_FILE_SIZE_MB * MIB,
            }
            options.update(overrides)
            runner = ConversionRunner(**options)
        await runner.start()
        assert runner.is_ready()
        return runner

    return build


# --- helpers -------------------------------------------------------------------


def _forkserver_children() -> set[int]:
    pid = multiprocessing.forkserver._forkserver._forkserver_pid
    if pid is None:
        return set()
    children: set[int] = set()
    try:
        for task in Path(f"/proc/{pid}/task").iterdir():
            children.update(int(c) for c in (task / "children").read_text().split())
    except OSError:
        pass
    return children


def _assert_nothing_left() -> None:
    assert multiprocessing.active_children() == []
    assert _forkserver_children() == set()


def _status_kib(pid: int | str) -> dict[str, int]:
    try:
        status = Path(f"/proc/{pid}/status").read_text()
    except OSError:
        return {}
    fields = {}
    for line in status.splitlines():
        key, _, value = line.partition(":")
        if key in ("VmRSS", "VmHWM", "VmPeak"):
            fields[key] = int(value.split()[0])
    return fields


def _parent_rss_mb() -> float:
    return _status_kib("self")["VmRSS"] / 1024


async def _run(runner: ConversionRunner, data: bytes, filename: str) -> ConversionOutcome:
    return await asyncio.wait_for(runner.run(ConversionRequest(data, filename, None)), RUN_GUARD_S)


async def _run_sampling_vm_peak(runner: ConversionRunner, data: bytes, filename: str) -> tuple[ConversionOutcome, int]:
    """Run once, reading the child's VmPeak (the high-water mark RLIMIT_AS is checked against) meanwhile."""
    task = asyncio.ensure_future(runner.run(ConversionRequest(data, filename, None)))
    peak_kib = 0
    deadline = time.monotonic() + RUN_GUARD_S
    while not task.done():
        assert time.monotonic() < deadline, "conversion did not finish in time"
        for pid in _forkserver_children():
            peak_kib = max(peak_kib, _status_kib(pid).get("VmPeak", 0))
        await asyncio.sleep(0.005)
    return task.result(), peak_kib // 1024


async def _wait_for_busy_child(min_rss_mb: int) -> int:
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        for pid in _forkserver_children():
            if _status_kib(pid).get("VmRSS", 0) > min_rss_mb * 1024:
                return pid
        await asyncio.sleep(0.005)
    raise AssertionError("no child got busy converting")


def _write_xlsx(dest: Path, rows: int, cols: int) -> bytes:
    wb = openpyxl.Workbook(write_only=True)
    ws = wb.create_sheet("Data")
    for r in range(rows):
        ws.append([f"r{r}c{c}" for c in range(cols)])
    wb.save(dest)
    return dest.read_bytes()


def _pivot_workbook() -> bytes:
    # A 150 MB pivot cache part is not a cell, so only streaming copies keep it cheap (4.3 note).
    base = io.BytesIO()
    wb = openpyxl.Workbook()
    wb.active.append(["region", "sales"])
    wb.active.append(["east", 10])
    wb.save(base)
    out = io.BytesIO()
    with zipfile.ZipFile(base) as src, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dest:
        for info in src.infolist():
            dest.writestr(info.filename, src.read(info))
        with dest.open("xl/pivotCache/pivotCacheRecords1.xml", "w") as part:
            chunk = bytes(MIB)
            for _ in range(150):
                part.write(chunk)
    return out.getvalue()


@pytest.fixture(scope="module")
def docx_48mb_12_images_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    dest = tmp_path_factory.mktemp("large") / "images48.docx"
    dest.write_bytes(make_docx("docx with twelve images", _random_images(12, 2048, seed=48)))
    return dest


@pytest.fixture(scope="module")
def one_sheet_at_the_cell_limit_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    # Converted as one piece, so it is the costliest workbook the cell pre-check lets through.
    dest = tmp_path_factory.mktemp("xlsx") / "one-sheet-at-limit.xlsx"
    write_xlsx_cells(dest, [("Data", Settings.model_fields["MAX_XLSX_CELLS"].default, 1)])
    return dest


@pytest.fixture
def one_sheet_at_the_cell_limit(one_sheet_at_the_cell_limit_path: Path) -> bytes:
    return one_sheet_at_the_cell_limit_path.read_bytes()


@pytest.fixture(scope="module")
def pivot_workbook() -> bytes:
    return _pivot_workbook()


# --- timeout (2.2, 2.5) ----------------------------------------------------------


async def test_timeout_on_a_large_xlsx_reaps_the_child_and_the_next_run_succeeds(
    make_runner: RunnerFactory, xlsx_large_for_timeout_path: Path
):
    # Settings.TIMEOUT_S is whole seconds and this workbook converts in well under one (1.4 note).
    short = await make_runner(timeout_s=0.2)
    normal = await make_runner()

    for _ in range(3):
        timed_out = await _run(short, xlsx_large_for_timeout_path.read_bytes(), "big.xlsx")
        assert isinstance(timed_out, ConversionFailure)
        assert timed_out.kind == "timeout"
        _assert_nothing_left()

        after = await _run(normal, xlsx_large_for_timeout_path.read_bytes(), "big.xlsx")
        assert isinstance(after, ConversionSuccess)
        assert "r13999c0" in after.pages[-1].content
        _assert_nothing_left()


async def test_timeouts_with_a_large_input_give_the_parent_memory_back(
    make_runner: RunnerFactory, docx_large_images_path: Path
):
    # The child keeps converting this 44 MB file until it is killed, so every run times out
    # however fast the machine is, with the whole input sent and held in the child.
    runner = await make_runner(timeout_s=0.5, child_target=child_targets.convert_forever_target)
    assert (await _run(runner, docx_large_images_path.read_bytes(), "warm.docx")).kind == "timeout"
    before_mb = _parent_rss_mb()

    for _ in range(3):
        outcome = await _run(runner, docx_large_images_path.read_bytes(), "big.docx")
        assert isinstance(outcome, ConversionFailure)
        assert outcome.kind == "timeout"
        _assert_nothing_left()

    # Less than one input's size: a buffer kept per run would add 44 MB each time.
    assert _parent_rss_mb() - before_mb < 24


# --- memory and CPU limits (2.6) ----------------------------------------------------


async def test_a_real_xlsx_over_a_small_rss_limit_is_memory_exceeded(
    make_runner: RunnerFactory, default_settings: Settings, one_sheet_at_the_cell_limit: bytes
):
    # 160 MB sits between an idle child (about 80 MB) and this workbook's peak (about 285 MB);
    # RLIMIT_AS (160 + 512 MB) stays above its VmPeak (about 420 MB), so the RSS check acts first.
    limits = replace(ConversionLimits.from_settings(default_settings), max_child_rss_mb=160)
    runner = await make_runner(limits=limits)

    outcome = await _run(runner, one_sheet_at_the_cell_limit, "big.xlsx")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "memory_exceeded"
    assert outcome.child_peak_rss_mb is not None and outcome.child_peak_rss_mb > 160
    _assert_nothing_left()


async def test_a_child_over_its_cpu_time_limit_is_killed_by_the_kernel_and_classified_as_timeout(
    make_runner: RunnerFactory,
):
    runner = await make_runner(timeout_s=20.0, child_target=child_targets.cpu_overrun_target)
    began = time.monotonic()
    outcome = await _run(runner, b"x", "ignored")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "timeout"
    # Ended by the 1 s CPU limit, long before the parent's 20 s deadline.
    assert time.monotonic() - began < 10.0
    _assert_nothing_left()


# --- crashes stay inside their child (2.7, 4.2) ------------------------------------


@pytest.mark.parametrize("crash", ["abort", "segfault"])
async def test_a_crashing_child_is_crashed_while_a_concurrent_conversion_succeeds(
    make_runner: RunnerFactory, pivot_workbook: bytes, crash: str
):
    runner = await make_runner(child_target=child_targets.crash_or_convert_target)
    converting = asyncio.ensure_future(_run(runner, pivot_workbook, "pivot.xlsx"))
    busy_pid = await _wait_for_busy_child(min_rss_mb=0)

    crashed = await _run(runner, b"x", crash)
    still_running_at_crash = not converting.done()
    converted = await converting

    assert isinstance(crashed, ConversionFailure)
    assert crashed.kind == "crashed"
    assert still_running_at_crash, f"conversion in child {busy_pid} ended before the crash"
    assert isinstance(converted, ConversionSuccess)
    assert "east" in converted.pages[0].content
    _assert_nothing_left()


async def test_a_panic_inside_the_real_child_entry_is_internal_and_the_next_run_succeeds(make_runner: RunnerFactory):
    panicking = await make_runner(child_target=child_targets.panic_in_convert_target)
    normal = await make_runner()

    outcome = await _run(panicking, make_text_pdf(["x"]), "doc.pdf")
    after = await _run(normal, make_text_pdf(["after the panic"]), "doc.pdf")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "internal"
    assert outcome.detail == "PanicException"
    assert isinstance(after, ConversionSuccess)
    assert after.pages[0].content == "after the panic"
    _assert_nothing_left()


# --- the requesting worker disappears -----------------------------------------------


def _read_line(stream: io.BufferedReader, timeout_s: float) -> str:
    ready, _, _ = select.select([stream], [], [], timeout_s)
    assert ready, "worker printed nothing"
    return stream.readline().decode().strip()


def test_force_killing_the_worker_ends_its_converting_child_within_2s(
    isolated_forkserver: None, one_sheet_at_the_cell_limit_path: Path, tmp_path: Path
):
    worker = subprocess.Popen(  # noqa: S603 - our own interpreter and script
        [sys.executable, str(WORKER), str(one_sheet_at_the_cell_limit_path)],
        stdout=subprocess.PIPE,
        # A killed worker cannot remove its forkserver's socket directory; keep it under tmp_path.
        env={**os.environ, "TMPDIR": str(tmp_path)},
        start_new_session=True,
    )
    pidfds: list[int] = []
    try:
        line = _read_line(worker.stdout, 30.0)
        forkserver_pid, child_pid = (int(part) for part in line.split())
        # A pidfd turns readable when the process exits, even if nobody reaps it (PID 1 here
        # may not), and is immune to pid reuse.
        child_fd = os.pidfd_open(child_pid)
        pidfds.append(child_fd)
        pidfds.append(os.pidfd_open(forkserver_pid))
        assert _status_kib(child_pid), "child already gone before the worker was killed"

        os.kill(worker.pid, signal.SIGKILL)
        killed_at = time.monotonic()
        exited, _, _ = select.select([child_fd], [], [], 2.0)
        elapsed = time.monotonic() - killed_at
        worker.wait(WAIT_S)

        assert exited, "conversion child outlived its worker by more than 2 s"
        assert elapsed < 2.0
    finally:
        try:
            os.killpg(worker.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        worker.wait(WAIT_S)
        worker.stdout.close()
        for fd in pidfds:
            select.select([fd], [], [], WAIT_S)
            os.close(fd)


# --- the default limits do not stop legitimate files ----------------------------------


@pytest.mark.parametrize(
    "case",
    [
        "docx_large_images_path",
        "docx_48mb_12_images_path",
        "pptx_large_images_path",
        "xlsx_large_for_timeout_path",
        "xlsx_one_sheet_at_the_cell_limit_10_columns",
        "xlsx_one_sheet_at_the_cell_limit_1_column",
        "pivot_workbook",
    ],
)
async def test_the_default_limits_let_large_legitimate_files_through(
    make_runner: RunnerFactory,
    default_settings: Settings,
    request: pytest.FixtureRequest,
    tmp_path: Path,
    case: str,
):
    cell_limit = default_settings.MAX_XLSX_CELLS
    # One sheet is converted in one piece, so a single sheet at the limit is the costliest shape.
    if case == "xlsx_one_sheet_at_the_cell_limit_10_columns":
        data, filename = _write_xlsx(tmp_path / "wide.xlsx", cell_limit // 10, 10), "wide.xlsx"
    elif case == "xlsx_one_sheet_at_the_cell_limit_1_column":
        data, filename = request.getfixturevalue("one_sheet_at_the_cell_limit"), "tall.xlsx"
    elif case == "pivot_workbook":
        data, filename = request.getfixturevalue(case), "pivot.xlsx"
    else:
        path: Path = request.getfixturevalue(case)
        data, filename = path.read_bytes(), path.name
    runner = await make_runner()
    rss_limit_mb = default_settings.MAX_CHILD_RSS_MB
    as_limit_mb = address_space_limit_bytes(rss_limit_mb) // MIB

    outcome, vm_peak_mb = await _run_sampling_vm_peak(runner, data, filename)

    assert isinstance(outcome, ConversionSuccess), outcome
    assert outcome.child_peak_rss_mb is not None
    # Measured peaks: 44-48 MB DOCX 265-281 MB, one 70k-cell sheet 285 MB (89 %).
    assert outcome.child_peak_rss_mb < 0.95 * rss_limit_mb
    assert 0 < vm_peak_mb < 0.8 * as_limit_mb
    _assert_nothing_left()


@pytest.mark.parametrize("shape", ["fixture", "one-sheet"])
async def test_an_xlsx_over_the_cell_limit_is_stopped_before_its_memory_grows(
    make_runner: RunnerFactory,
    default_settings: Settings,
    xlsx_over_cell_limit_path: Path,
    tmp_path: Path,
    shape: str,
):
    if shape == "fixture":
        data = xlsx_over_cell_limit_path.read_bytes()
    else:
        dest = tmp_path / "over.xlsx"
        write_xlsx_cells(dest, [("Data", default_settings.MAX_XLSX_CELLS, 1)], tail_cells=1)
        data = dest.read_bytes()
    runner = await make_runner()
    outcome = await _run(runner, data, "over.xlsx")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == "limit_exceeded"
    # An idle child is about 80 MB; reaching anydoc would push a sheet this size past 280 MB.
    assert outcome.child_peak_rss_mb is not None
    assert outcome.child_peak_rss_mb < 0.4 * default_settings.MAX_CHILD_RSS_MB
    _assert_nothing_left()


# --- inputs the converters cannot bound are stopped by the child's limits ---------------


def _csv_20mb() -> bytes:
    return b"a,b,c,d\n" * (20 * MIB // 8)


@pytest.mark.parametrize(
    ("build", "filename", "kind"),
    [
        pytest.param(_csv_20mb, "big.csv", "memory_exceeded", id="csv-20mb"),
        pytest.param(lambda: b"<a" + b"/" * 4_000_000 + b">", "slashes.html", "memory_exceeded", id="html-slashes"),
        pytest.param(lambda: b"</a" + b" x" * 2_000_000 + b">", "end-tag.html", "memory_exceeded", id="html-end-attrs"),
        pytest.param(lambda: b"<a " + b"x " * 2_000_000 + b">", "attrs.html", "memory_exceeded", id="html-attrs"),
    ],
)
async def test_text_inputs_that_blow_up_in_memory_are_stopped_and_the_next_run_succeeds(
    make_runner: RunnerFactory, default_settings: Settings, build: Callable[[], bytes], filename: str, kind: str
):
    # The size caps are lifted so these show the RSS limit itself; the pathological HTML is far below the cap anyway.
    runner = await make_runner(limits=_without_input_size_caps(default_settings))
    outcome = await _run(runner, build(), filename)
    after = await _run(runner, b"plain text after", "after.txt")

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == kind
    assert isinstance(after, ConversionSuccess)
    _assert_nothing_left()


@pytest.mark.parametrize(("filename", "kind"), [("big.csv", "memory_exceeded"), ("big.html", "result_too_large")])
async def test_a_large_docx_sent_as_text_is_stopped_by_the_child_limits(
    make_runner: RunnerFactory, default_settings: Settings, docx_large_images_path: Path, filename: str, kind: str
):
    runner = await make_runner(limits=_without_input_size_caps(default_settings))
    outcome = await _run(runner, docx_large_images_path.read_bytes(), filename)

    assert isinstance(outcome, ConversionFailure)
    assert outcome.kind == kind
    _assert_nothing_left()


@pytest.mark.parametrize("filename", ["big.csv", "big.tsv", "big.html"])
async def test_with_the_default_caps_large_csv_and_html_never_reach_a_child(
    make_runner: RunnerFactory, docx_large_images_path: Path, filename: str
):
    runner = await make_runner()
    # The DOCX is larger than both caps; the 20 MiB CSV is larger than the CSV cap only.
    inputs = [docx_large_images_path.read_bytes()] + ([_csv_20mb()] if filename != "big.html" else [])
    for data in inputs:
        outcome = await _run(runner, data, filename)

        assert isinstance(outcome, ConversionFailure)
        assert outcome.kind == "limit_exceeded"
        assert outcome.child_peak_rss_mb is None
    _assert_nothing_left()


def _without_input_size_caps(settings: Settings) -> ConversionLimits:
    any_upload = settings.MAX_FILE_SIZE_MB * MIB
    return replace(ConversionLimits.from_settings(settings), max_csv_bytes=any_upload, max_html_bytes=any_upload)


def _pdf_page_with_four_million_characters() -> bytes:
    # One string operand is capped at 32767 characters by pdfium, so the page shows many of them.
    line = b"(" + b"a" * 1000 + b") Tj 0 -1 Td\n"
    content = b"BT /F1 1 Tf 72 700 Td\n" + line * 4000 + b"ET"
    return _build_pdf([(b"<< /Font << /F1 3 0 R >> >>", content)], [])


async def test_a_pdf_page_with_four_million_characters_is_stopped_and_the_next_run_succeeds(
    make_runner: RunnerFactory,
):
    runner = await make_runner()
    outcome = await _run(runner, _pdf_page_with_four_million_characters(), "long-page.pdf")
    after = await _run(runner, make_text_pdf(["after the long page"]), "doc.pdf")

    assert isinstance(outcome, ConversionFailure), outcome
    assert outcome.kind == "memory_exceeded"
    assert isinstance(after, ConversionSuccess)
    _assert_nothing_left()
