"""Forkserver start-up, dependency preload and readiness (design: ConversionRunner; Req 2.5, 3.2)."""

from __future__ import annotations

import json
import logging
import multiprocessing
import multiprocessing.forkserver
import multiprocessing.spawn
import os
import signal
import sys
import threading
import time
from collections.abc import Callable, Iterator
from multiprocessing.connection import Connection
from pathlib import Path

import pytest

from app.runner import conversion_runner
from app.runner.conversion_runner import CONVERSION_DEPENDENCIES, ConversionRunner

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(not sys.platform.startswith("linux"), reason="forkserver liveness relies on Linux pidfd"),
]

WAIT_S = 10.0
ENV_KEYS = ("RAYON_NUM_THREADS",)


def _env_probe(conn: Connection) -> None:
    # Runs inside a forkserver child: reports what the forkserver handed down to every conversion child.
    conn.send_bytes(
        json.dumps(
            {
                "forkserver_pid": os.getppid(),
                "rayon": os.environ.get("RAYON_NUM_THREADS"),
                "loaded": sorted(name for name in sys.modules if name.split(".")[0] in {"anydoc", "pypdfium2"}),
                "app_main_loaded": "app.main" in sys.modules,
                "app_config_loaded": "app.config" in sys.modules,
            }
        ).encode()
    )
    conn.close()


def _probe_child() -> dict:
    ctx = multiprocessing.get_context("forkserver")
    receiver, sender = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_env_probe, args=(sender,), daemon=True)
    process.start()
    sender.close()
    try:
        assert receiver.poll(WAIT_S), "probe child did not answer"
        return json.loads(receiver.recv_bytes())
    finally:
        receiver.close()
        process.join(WAIT_S)
        if process.is_alive():
            process.kill()
            process.join(WAIT_S)


def _wait_until(predicate: Callable[[], bool], timeout_s: float = WAIT_S) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


def _pid_exists(pid: int) -> bool:
    status = Path(f"/proc/{pid}/status")
    if not status.exists():
        return False
    return "State:\tZ" not in status.read_text()


def _stop_any_forkserver() -> None:
    for child in multiprocessing.active_children():
        child.kill()
        child.join(WAIT_S)
    # A forkserver frozen by a test (SIGSTOP, an import that sleeps) would never exit on its own.
    pid = multiprocessing.forkserver._forkserver._forkserver_pid
    if pid is not None:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    # Test-only stdlib hook ("Method used by unit tests to stop the server"); other test files may
    # have started a forkserver with the default preload in this same pytest process.
    multiprocessing.forkserver._forkserver._stop()


@pytest.fixture
def isolated_forkserver() -> Iterator[None]:
    saved_env = {key: os.environ.pop(key, None) for key in ENV_KEYS}
    _stop_any_forkserver()
    yield
    _stop_any_forkserver()
    multiprocessing.get_context("forkserver").set_forkserver_preload(["__main__"])
    for key, value in saved_env.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    assert multiprocessing.active_children() == []
    assert _probe_threads() == []


def _probe_threads() -> list[threading.Thread]:
    return [thread for thread in threading.enumerate() if thread.name.startswith("readiness-probe")]


def _standard_forkserver_pid() -> int | None:
    return multiprocessing.forkserver._forkserver._forkserver_pid


@pytest.fixture
async def started_runner(isolated_forkserver: None) -> ConversionRunner:
    runner = ConversionRunner()
    await runner.start()
    try:
        yield runner
    finally:
        runner.stop()


async def test_is_not_ready_before_start(isolated_forkserver: None):
    assert ConversionRunner().is_ready() is False


async def test_is_ready_after_start_with_every_dependency_loaded(started_runner: ConversionRunner):
    assert started_runner.is_ready() is True
    readiness = started_runner.readiness()
    assert readiness.ready is True
    assert dict(readiness.dependencies) == {name: "ok" for name in CONVERSION_DEPENDENCIES}


async def test_preload_holds_the_native_conversion_libraries_in_the_forkserver(started_runner: ConversionRunner):
    probe = _probe_child()
    maps = Path(f"/proc/{probe['forkserver_pid']}/maps").read_text()
    assert "_anydoc" in maps
    assert "pdfium" in maps
    assert "anydoc" in probe["loaded"]
    assert "pypdfium2" in probe["loaded"]


async def test_preload_does_not_load_the_http_app_or_settings(started_runner: ConversionRunner):
    probe = _probe_child()
    assert probe["app_main_loaded"] is False
    assert probe["app_config_loaded"] is False


async def test_children_inherit_a_single_rayon_thread(started_runner: ConversionRunner):
    probe = _probe_child()
    assert probe["rayon"] == "1"
    environ = Path(f"/proc/{probe['forkserver_pid']}/environ").read_bytes().split(b"\0")
    assert b"RAYON_NUM_THREADS=1" in environ


async def test_operator_set_rayon_threads_is_respected(isolated_forkserver: None):
    os.environ["RAYON_NUM_THREADS"] = "2"
    runner = ConversionRunner()
    await runner.start()
    try:
        assert _probe_child()["rayon"] == "2"
    finally:
        runner.stop()


async def test_starting_twice_keeps_the_same_forkserver(started_runner: ConversionRunner):
    first = _probe_child()["forkserver_pid"]
    await started_runner.start()
    assert started_runner.is_ready() is True
    assert _probe_child()["forkserver_pid"] == first


async def test_is_not_ready_after_stop_and_the_forkserver_is_gone(isolated_forkserver: None):
    runner = ConversionRunner()
    await runner.start()
    forkserver_pid = _probe_child()["forkserver_pid"]
    assert runner.is_ready() is True

    runner.stop()

    assert runner.is_ready() is False
    assert runner.readiness().ready is False
    assert _wait_until(lambda: not _pid_exists(forkserver_pid))


async def test_death_of_the_forkserver_is_reported_without_restarting_it(started_runner: ConversionRunner):
    forkserver_pid = _probe_child()["forkserver_pid"]

    os.kill(forkserver_pid, signal.SIGKILL)

    assert _wait_until(lambda: started_runner.is_ready() is False)
    # The readiness check itself must not spawn: a spawn would silently restart the forkserver.
    time.sleep(0.1)
    assert started_runner.is_ready() is False
    assert multiprocessing.forkserver._forkserver._forkserver_pid == forkserver_pid


async def test_verify_restarts_a_dead_forkserver_with_the_same_preload(started_runner: ConversionRunner):
    dead_pid = _probe_child()["forkserver_pid"]
    os.kill(dead_pid, signal.SIGKILL)
    assert _wait_until(lambda: started_runner.is_ready() is False)

    readiness = started_runner.verify()

    assert readiness.ready is True
    assert started_runner.is_ready() is True
    probe = _probe_child()
    assert probe["forkserver_pid"] != dead_pid
    assert "anydoc" in probe["loaded"]
    assert "_anydoc" in Path(f"/proc/{probe['forkserver_pid']}/maps").read_text()


async def test_a_dependency_that_cannot_be_loaded_reports_not_ready(
    isolated_forkserver: None, caplog: pytest.LogCaptureFixture
):
    missing = "app_runner_missing_dependency_for_test"
    runner = ConversionRunner(dependencies=(*CONVERSION_DEPENDENCIES, missing))
    with caplog.at_level(logging.WARNING, logger="app.runner.conversion_runner"):
        await runner.start()
    try:
        readiness = runner.readiness()
        assert runner.is_ready() is False
        assert readiness.dependencies[missing] == "missing"
        assert all(readiness.dependencies[name] == "ok" for name in CONVERSION_DEPENDENCIES)
        assert missing in caplog.text
    finally:
        runner.stop()


async def test_a_broken_forkserver_reports_not_ready_instead_of_raising(isolated_forkserver: None):
    # An unreachable interpreter makes every forkserver start fail; start() must survive it.
    runner = ConversionRunner(probe_timeout_s=2.0)
    ctx = multiprocessing.get_context("forkserver")
    original = multiprocessing.spawn.get_executable()
    ctx.set_executable("/nonexistent/python-for-test")
    try:
        await runner.start()
        assert runner.is_ready() is False
    finally:
        ctx.set_executable(original)
        runner.stop()


PROBE_TIMEOUT_S = 1.0
# Margin for killing the frozen forkserver and reaping what it left behind.
RETURN_MARGIN_S = 3.0


async def test_a_forkserver_restarted_by_a_normal_spawn_needs_reverifying(started_runner: ConversionRunner):
    dead_pid = _probe_child()["forkserver_pid"]
    os.kill(dead_pid, signal.SIGKILL)
    assert _wait_until(lambda: not _pid_exists(dead_pid))

    new_pid = _probe_child()["forkserver_pid"]  # the standard Process.start() path restarts it

    assert new_pid != dead_pid
    readiness = started_runner.readiness()
    assert readiness.ready is False
    assert readiness.stale is True
    verified = started_runner.verify()
    assert verified.ready is True
    assert verified.forkserver_pid == new_pid
    assert started_runner.readiness().stale is False
    assert started_runner.is_ready() is True


def _deny_pidfd(_pid: int, _flags: int = 0) -> int:
    raise PermissionError(1, "Operation not permitted")


@pytest.mark.parametrize(
    "fallback",
    [
        "pidfd_missing",
        "pidfd_permission_denied",
        # Each remaining signal alone must still catch the restart.
        "pid_comparison_only",
        "pid_liveness_only",
    ],
)
async def test_restart_is_detected_without_pidfd(
    isolated_forkserver: None, monkeypatch: pytest.MonkeyPatch, fallback: str
):
    if fallback == "pidfd_permission_denied":
        monkeypatch.setattr(os, "pidfd_open", _deny_pidfd)
    else:
        monkeypatch.delattr(os, "pidfd_open", raising=False)
    if fallback == "pid_comparison_only":
        monkeypatch.setattr(conversion_runner, "_pid_alive", lambda _pid: True)
    if fallback == "pid_liveness_only":
        monkeypatch.setattr(conversion_runner, "_standard_forkserver_pid", lambda: conversion_runner._UNKNOWN)
    runner = ConversionRunner()
    await runner.start()
    try:
        assert runner.is_ready() is True
        dead_pid = _probe_child()["forkserver_pid"]
        os.kill(dead_pid, signal.SIGKILL)
        assert _wait_until(lambda: not _pid_exists(dead_pid))
        _probe_child()

        assert runner.is_ready() is False
        assert runner.readiness().stale is True
        assert runner.verify().ready is True
        assert runner.is_ready() is True
    finally:
        runner.stop()


async def test_verify_returns_within_the_timeout_when_the_forkserver_is_frozen(isolated_forkserver: None):
    runner = ConversionRunner(probe_timeout_s=PROBE_TIMEOUT_S)
    await runner.start()
    try:
        frozen_pid = _probe_child()["forkserver_pid"]
        os.kill(frozen_pid, signal.SIGSTOP)

        began = time.monotonic()
        readiness = runner.verify()
        elapsed = time.monotonic() - began

        assert readiness.ready is False
        assert runner.is_ready() is False
        assert elapsed < PROBE_TIMEOUT_S + RETURN_MARGIN_S
        assert _wait_until(lambda: _probe_threads() == [])
        assert multiprocessing.active_children() == []

        # The standard spawn path brings up a working forkserver again.
        assert _probe_child()["forkserver_pid"] != frozen_pid
        assert runner.verify().ready is True
    finally:
        try:
            os.kill(frozen_pid, signal.SIGCONT)
        except ProcessLookupError:
            pass
        runner.stop()


async def test_start_returns_within_the_timeout_when_a_preload_import_hangs(
    isolated_forkserver: None, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    hanging = "app_runner_hanging_import_for_test"
    (tmp_path / f"{hanging}.py").write_text("import time\ntime.sleep(30)\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    runner = ConversionRunner(dependencies=(*CONVERSION_DEPENDENCIES, hanging), probe_timeout_s=PROBE_TIMEOUT_S)

    began = time.monotonic()
    await runner.start()
    elapsed = time.monotonic() - began

    try:
        assert elapsed < PROBE_TIMEOUT_S + RETURN_MARGIN_S
        assert runner.is_ready() is False
        assert _wait_until(lambda: _probe_threads() == [])
    finally:
        runner.stop()
