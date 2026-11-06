"""Fixtures shared by the runner tests that start a real forkserver."""

from __future__ import annotations

import multiprocessing
import multiprocessing.forkserver
import os
import signal
import threading
from collections.abc import Iterator

import pytest

WAIT_S = 10.0
ENV_KEYS = ("RAYON_NUM_THREADS",)


def _stop_any_forkserver() -> None:
    for child in multiprocessing.active_children():
        child.kill()
        child.join(WAIT_S)
    # A forkserver frozen by a test (SIGSTOP, an import that sleeps) would never exit on its own.
    pid = multiprocessing.forkserver._forkserver._forkserver_pid
    if pid is not None:
        try:
            os.kill(pid, signal.SIGCONT)
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    # Test-only stdlib hook ("Method used by unit tests to stop the server"); other test files may
    # have started a forkserver with the default preload in this same pytest process.
    multiprocessing.forkserver._forkserver._stop()


def _probe_threads() -> list[threading.Thread]:
    return [thread for thread in threading.enumerate() if thread.name.startswith("readiness-probe")]


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
