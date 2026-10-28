"""Run the real service under uvicorn in a subprocess, for tests that need a real HTTP server.

TestClient hands the whole request body to the app in one message, so it cannot show what
happens while a body is still arriving (byte counting, the receive deadline, an early 503) or
what the production process writes to stderr. These tests start `uvicorn app.main:app` as the
Dockerfile does.
"""

from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx

TOKEN = "live-server-token-5d1e"  # noqa: S105 — test credential
AUTH = {"Authorization": f"Bearer {TOKEN}"}
SERVICE_DIR = Path(__file__).parents[1]
_READY_TIMEOUT_S = 30.0
_STOP_TIMEOUT_S = 20.0


@dataclass(frozen=True)
class LiveServer:
    port: int
    tmpdir: Path
    stderr_path: Path
    process: subprocess.Popen[bytes]

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def stderr(self) -> str:
        return self.stderr_path.read_text(errors="replace")

    def stop(self) -> int:
        """Graceful shutdown (SIGTERM, as Kubernetes and docker do); returns the exit code."""
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(_STOP_TIMEOUT_S)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(_STOP_TIMEOUT_S)
        return self.process.returncode


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_ready(server: LiveServer) -> None:
    deadline = time.monotonic() + _READY_TIMEOUT_S
    while time.monotonic() < deadline:
        if server.process.poll() is not None:
            raise RuntimeError(f"uvicorn exited early:\n{server.stderr()}")
        try:
            if httpx.get(f"{server.url}/readyz", timeout=2).status_code == 200:
                return
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    raise RuntimeError(f"uvicorn did not become ready:\n{server.stderr()}")


@contextmanager
def live_server(env: Mapping[str, object] | None = None, *, tmp_root: str | None = None) -> Iterator[LiveServer]:
    """Start uvicorn with `env` on top of the current environment and a private, short TMPDIR.

    `tmp_root` is where TMPDIR is created (it must stay short: the forkserver socket path is
    limited to 108 bytes). The whole process group is killed on exit, so nothing outlives the test.
    """
    tmpdir = Path(tempfile.mkdtemp(prefix="ate-", dir=tmp_root))
    stderr_path = tmpdir.parent / f"{tmpdir.name}.stderr"
    port = _free_port()
    child_env = {
        **os.environ,
        "ATTACHMENT_EXTRACTOR_SERVICE_TOKEN": TOKEN,
        "TMPDIR": str(tmpdir),
        "PYTHONUNBUFFERED": "1",
        **{key: str(value) for key, value in (env or {}).items()},
    }
    with stderr_path.open("wb") as stderr:
        process = subprocess.Popen(  # noqa: S603 — fixed argv
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=SERVICE_DIR,
            env=child_env,
            stdout=subprocess.DEVNULL,
            stderr=stderr,
            start_new_session=True,
        )
    server = LiveServer(port=port, tmpdir=tmpdir, stderr_path=stderr_path, process=process)
    try:
        _wait_ready(server)
        yield server
    finally:
        server.stop()
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        shutil.rmtree(tmpdir, ignore_errors=True)
        stderr_path.unlink(missing_ok=True)
