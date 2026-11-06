"""A caller that gives up mid-conversion, against a real uvicorn process (see tests/live_server.py).

TestClient never disconnects, so only a real server shows that the conversion child is killed
and the concurrency slot comes back as soon as the caller closes its connection. The app is
the real one with a stand-in child (`live_apps:app`) whose file name says how long it works
and where it writes its pid.

Requirements: 2.9
"""

from __future__ import annotations

import os
import socket
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

from live_server import AUTH, TOKEN, LiveServer, live_server

BOUNDARY = "disconnectboundary51ab"
WAIT_S = 10.0
# Generous on purpose: the requirement is "soon", not a tight wall-clock bound.
GONE_WITHIN_S = 3.0
LONG_CONVERSION_S = 30


def _send_extract(server: LiveServer, filename: str, data: bytes = b"x") -> socket.socket:
    """Send one complete POST /extract and return the socket without reading the answer."""
    body = (
        (
            f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode()
        + data
        + f"\r\n--{BOUNDARY}--\r\n".encode()
    )
    head = (
        "POST /extract HTTP/1.1\r\nHost: test\r\n"
        f"Authorization: Bearer {TOKEN}\r\n"
        f"Content-Type: multipart/form-data; boundary={BOUNDARY}\r\n"
        f"Content-Length: {len(body)}\r\n\r\n"
    ).encode()
    sock = socket.create_connection(("127.0.0.1", server.port), timeout=30)
    sock.sendall(head + body)
    return sock


def _wait_for(condition, timeout: float, what: str) -> None:  # noqa: ANN001
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, f"timed out waiting for {what}"
        time.sleep(0.02)


def _child_pid(pid_file: Path) -> int:
    _wait_for(lambda: pid_file.exists() and pid_file.read_text() != "", WAIT_S, "the child to start")
    return int(pid_file.read_text())


def _alive(pid: int) -> bool:
    try:
        state = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
    except (FileNotFoundError, ProcessLookupError):
        return False
    return state != "Z"


def _descendants(pid: int) -> list[int]:
    found: list[int] = []
    pending = [pid]
    while pending:
        current = pending.pop()
        for task in Path(f"/proc/{current}/task").iterdir():
            try:
                children = [int(c) for c in (task / "children").read_text().split()]
            except FileNotFoundError:
                continue
            found.extend(children)
            pending.extend(children)
    return found


def _zombies(pids: list[int]) -> list[int]:
    zombies = []
    for pid in pids:
        try:
            if Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0] == "Z":
                zombies.append(pid)
        except FileNotFoundError:
            pass
    return zombies


def _fd_count(pid: int) -> int:
    return len(os.listdir(f"/proc/{pid}/fd"))


def _post(server: LiveServer, filename: str, data: bytes = b"after") -> httpx.Response:
    return httpx.post(f"{server.url}/extract", headers=AUTH, files={"file": (filename, data)}, timeout=30)


def _assert_clean_stderr(server: LiveServer) -> None:
    stderr = server.stderr()
    for marker in ("Traceback", "Exception in ASGI application", " ERROR "):
        assert marker not in stderr, stderr


@pytest.fixture(scope="module")
def server() -> Iterator[LiveServer]:
    with live_server({"MAX_CONCURRENCY": 3}, app="live_apps:app") as server:
        yield server


class TestCallerGivesUpMidConversion:
    def test_every_slot_comes_back_and_each_child_is_killed(self, server: LiveServer, tmp_path: Path) -> None:
        pid_files = [tmp_path / f"pid{i}" for i in range(3)]
        socks = [_send_extract(server, f"{LONG_CONVERSION_S}:{pid_file}") for pid_file in pid_files]
        pids = [_child_pid(pid_file) for pid_file in pid_files]
        assert all(_alive(pid) for pid in pids)
        # Every slot is held by a conversion that would take 30 s.
        assert _post(server, "0").status_code == 503

        for sock in socks:
            sock.close()

        _wait_for(lambda: not any(_alive(pid) for pid in pids), GONE_WITHIN_S, "the children to be killed")
        _wait_for(lambda: _post(server, "0").status_code != 503, GONE_WITHIN_S, "the slots to come back")
        response = _post(server, "0", b"after")
        assert response.status_code == 200
        assert response.json()["pages"][0]["content"] == "received 5 bytes"

        time.sleep(0.2)
        lines = [line for line in server.stderr().splitlines() if "extract format=" in line]
        assert sum("result=client_disconnected" in line for line in lines) >= 3
        _assert_clean_stderr(server)

    def test_thirty_disconnects_leak_no_fds_children_or_zombies(self, server: LiveServer, tmp_path: Path) -> None:
        assert _post(server, "0").status_code == 200
        worker = server.process.pid
        fds, children = _fd_count(worker), sorted(_descendants(worker))

        for i in range(30):
            pid_file = tmp_path / f"pid{i}"
            sock = _send_extract(server, f"{LONG_CONVERSION_S}:{pid_file}")
            pid = _child_pid(pid_file)
            sock.close()
            _wait_for(lambda pid=pid: not _alive(pid), GONE_WITHIN_S, f"child {i} to be killed")

        _wait_for(lambda: sorted(_descendants(worker)) == children, GONE_WITHIN_S, "the process tree to settle")
        assert _zombies(_descendants(worker)) == []
        assert _post(server, "0").status_code == 200
        _wait_for(lambda: _fd_count(worker) <= fds, GONE_WITHIN_S, "the fd count to return to its baseline")
        _assert_clean_stderr(server)


class TestCallerThatWaits:
    def test_a_caller_that_waits_gets_the_result(self, server: LiveServer) -> None:
        began = time.monotonic()
        response = _post(server, "0.5", b"payload")
        assert response.status_code == 200
        assert response.json()["pages"][0]["content"] == "received 7 bytes"
        assert time.monotonic() - began >= 0.5

    def test_leaving_right_as_the_conversion_finishes_is_harmless(self, server: LiveServer) -> None:
        # The close lands just before, at, or just after the response is written.
        for offset in (-0.05, -0.02, 0.0, 0.01, 0.02, 0.05, 0.1):
            sock = _send_extract(server, "0.3")
            time.sleep(max(0.0, 0.3 + offset))
            sock.close()
        time.sleep(0.5)
        assert _post(server, "0").status_code == 200
        _assert_clean_stderr(server)
