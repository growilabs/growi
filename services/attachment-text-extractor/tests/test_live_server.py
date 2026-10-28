"""POST /extract intake and logging against a real uvicorn process (see tests/live_server.py).

Covers what TestClient cannot show: the slot is taken before the body is received, the body
is capped and deadlined while it streams in, the upload never lands in TMPDIR (a small tmpfs
in production), and the per-request log line reaches the process's stderr.

Requirements: 2.1, 2.3, 2.7, 3.3, 4.2
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import socket
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

from live_server import AUTH, TOKEN, LiveServer, live_server

MIB = 1024 * 1024
BOUNDARY = "liveboundary7c2e"
CONTENT_MARKER = "LIVE-CONTENT-MARKER-3b9d"
FILE_NAME_MARKER = "LIVE-FILE-NAME-MARKER-a41f"
SHM = Path("/dev/shm")


def _tmpfs_mounts() -> set[str]:
    try:
        lines = Path("/proc/mounts").read_text().splitlines()
    except OSError:
        return set()
    return {fields[1] for fields in (line.split() for line in lines) if len(fields) > 2 and fields[2] == "tmpfs"}


def _used_bytes(path: Path) -> int:
    stat = os.statvfs(path)
    return (stat.f_blocks - stat.f_bfree) * stat.f_frsize


def _post(server: LiveServer, name: str, data: bytes, timeout: float = 120) -> httpx.Response:
    return httpx.post(f"{server.url}/extract", headers=AUTH, files={"file": (name, data)}, timeout=timeout)


def _multipart_head(name: str) -> bytes:
    return (
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode()


def _multipart_tail() -> bytes:
    return f"\r\n--{BOUNDARY}--\r\n".encode()


def _request_head(content_length: int) -> bytes:
    return (
        "POST /extract HTTP/1.1\r\nHost: test\r\n"
        f"Authorization: Bearer {TOKEN}\r\n"
        f"Content-Type: multipart/form-data; boundary={BOUNDARY}\r\n"
        f"Content-Length: {content_length}\r\nConnection: close\r\n\r\n"
    ).encode()


def _open_upload(server: LiveServer, declared_file_bytes: int, sent_file_bytes: int) -> socket.socket:
    """Send the headers and the first `sent_file_bytes` of a file declared as `declared_file_bytes`."""
    head = _multipart_head("a.txt")
    length = len(head) + declared_file_bytes + len(_multipart_tail())
    sock = socket.create_connection(("127.0.0.1", server.port), timeout=30)
    sock.sendall(_request_head(length) + head + b"x" * sent_file_bytes)
    return sock


def _read_response(sock: socket.socket, timeout: float) -> tuple[int, dict]:
    sock.settimeout(timeout)
    raw = b""
    while b"\r\n\r\n" not in raw or not _body_complete(raw):
        chunk = sock.recv(65536)
        if not chunk:
            break
        raw += chunk
    head, _, body = raw.partition(b"\r\n\r\n")
    status = int(head.split(b" ", 2)[1])
    return status, json.loads(body or b"{}")


def _body_complete(raw: bytes) -> bool:
    head, _, body = raw.partition(b"\r\n\r\n")
    match = re.search(rb"content-length: *(\d+)", head, re.IGNORECASE)
    return match is not None and len(body) >= int(match.group(1))


def _chunked_upload(server: LiveServer, file_bytes: int, *, chunk: int = 64 * 1024) -> tuple[int, dict, int]:
    """Send a chunked multipart body (no Content-Length); return the status, body and bytes sent."""
    head = (
        "POST /extract HTTP/1.1\r\nHost: test\r\n"
        f"Authorization: Bearer {TOKEN}\r\n"
        f"Content-Type: multipart/form-data; boundary={BOUNDARY}\r\n"
        "Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
    ).encode()
    pieces = [_multipart_head("a.txt"), *(b"x" * min(chunk, file_bytes - i) for i in range(0, file_bytes, chunk))]
    pieces.append(_multipart_tail())
    sent = 0
    with socket.create_connection(("127.0.0.1", server.port), timeout=30) as sock:
        sock.sendall(head)
        try:
            for piece in pieces:
                sock.sendall(b"%x\r\n%s\r\n" % (len(piece), piece))
                sent += len(piece)
            sock.sendall(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass  # the server answered early and stopped reading
        status, body = _read_response(sock, timeout=10)
    return status, body, sent


def _small_ok(server: LiveServer) -> None:
    response = _post(server, "ok.txt", b"still serving")
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# B-1: the upload goes to memory, never to TMPDIR, and is capped while it streams in
# ---------------------------------------------------------------------------


class TestUploadsDoNotUseTmpdir:
    @pytest.fixture(scope="class")
    def server(self) -> Iterator[LiveServer]:
        # A dedicated tmpfs holds TMPDIR, so its usage shows whether an upload was spooled there.
        if str(SHM) not in _tmpfs_mounts():
            pytest.skip("/dev/shm is not a tmpfs here; the TMPDIR usage checks need a dedicated tmpfs")
        with live_server({"MAX_CONCURRENCY": 3}, tmp_root=str(SHM)) as server:
            yield server

    def test_three_concurrent_25mb_uploads_are_never_a_parse_error(self, server: LiveServer) -> None:
        before = _used_bytes(SHM)
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            responses = list(pool.map(lambda _: _post(server, "a.txt", b"a " * (25 * MIB // 2)), range(3)))
        for response in responses:
            assert response.status_code in (200, 422, 503), response.text
            if response.status_code != 200:
                assert response.json()["code"] in ("resource_limit_exceeded", "service_busy")
        assert _used_bytes(SHM) - before < MIB
        _small_ok(server)

    def test_upload_over_the_limit_is_413_and_tmpdir_stays_at_baseline(self, server: LiveServer) -> None:
        before = _used_bytes(SHM)
        response = _post(server, "big.txt", b"x" * (70 * MIB))
        assert response.status_code == 413, response.text
        assert response.json()["code"] == "file_too_large"
        assert _used_bytes(SHM) - before < MIB
        _small_ok(server)

    def test_two_concurrent_40mib_uploads_leave_the_service_usable(self, server: LiveServer) -> None:
        before = _used_bytes(SHM)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            responses = list(pool.map(lambda _: _post(server, "a.txt", b"b " * (40 * MIB // 2)), range(2)))
        for response in responses:
            assert response.status_code in (200, 422, 503), response.text
        assert _used_bytes(SHM) - before < MIB
        _small_ok(server)


class TestIntakeOrder:
    def test_oversized_content_length_is_413_without_receiving_the_body(self) -> None:
        with live_server({"MAX_FILE_SIZE_MB": 1}) as server:
            sock = _open_upload(server, declared_file_bytes=10 * 1024 * MIB, sent_file_bytes=0)
            with sock:
                status, body = _read_response(sock, timeout=5)
            assert status == 413
            assert body["code"] == "file_too_large"
            _small_ok(server)

    def test_chunked_body_over_the_cap_is_413_while_it_streams_in(self) -> None:
        # No Content-Length: only counting the bytes that arrive can stop this body.
        with live_server({"MAX_FILE_SIZE_MB": 1, "MAX_CONCURRENCY": 1}) as server:
            status, body, sent = _chunked_upload(server, 20 * MIB)
            assert status == 413
            assert body["code"] == "file_too_large"
            assert sent < 20 * MIB
            _small_ok(server)

    def test_chunked_body_within_the_cap_is_extracted(self) -> None:
        with live_server({"MAX_FILE_SIZE_MB": 1, "MAX_CONCURRENCY": 1}) as server:
            status, body, _ = _chunked_upload(server, 200 * 1024)
            assert status == 200, body
            assert body["extractedCharacters"] == 200 * 1024

    def test_busy_service_answers_503_while_the_client_is_still_uploading(self) -> None:
        with live_server({"MAX_CONCURRENCY": 1, "UPLOAD_TIMEOUT_S": 20}) as server:
            # The first upload takes the only slot and then stalls mid-body.
            holder = _open_upload(server, declared_file_bytes=MIB, sent_file_bytes=1000)
            with holder:
                time.sleep(0.5)
                probe = _open_upload(server, declared_file_bytes=MIB, sent_file_bytes=1000)
                with probe:
                    began = time.monotonic()
                    status, body = _read_response(probe, timeout=5)
                    assert time.monotonic() - began < 2.0
                assert status == 503
                assert body["code"] == "service_busy"
            # Closing the stalled upload gives the slot back.
            deadline = time.monotonic() + 10
            while _post(server, "ok.txt", b"after").status_code == 503 and time.monotonic() < deadline:
                time.sleep(0.1)
            _small_ok(server)

    def test_stalled_body_is_cut_off_by_the_upload_deadline_and_frees_the_slot(self) -> None:
        with live_server({"MAX_CONCURRENCY": 1, "UPLOAD_TIMEOUT_S": 1}) as server:
            sock = _open_upload(server, declared_file_bytes=MIB, sent_file_bytes=10)
            with sock:
                began = time.monotonic()
                status, body = _read_response(sock, timeout=10)
                elapsed = time.monotonic() - began
            assert status == 408
            assert body["code"] == "extraction_timeout"
            assert elapsed < 5.0
            _small_ok(server)

    def test_unauthenticated_upload_is_401_before_the_slot_is_taken(self) -> None:
        with live_server({"MAX_CONCURRENCY": 1}) as server:
            response = httpx.post(f"{server.url}/extract", files={"file": ("a.txt", b"x" * MIB)}, timeout=30)
            assert response.status_code == 401
            _small_ok(server)


# ---------------------------------------------------------------------------
# I-1: the per-request line reaches the production process's stderr
# ---------------------------------------------------------------------------


class TestProductionLogging:
    def test_one_request_line_per_request_on_stderr_without_secrets(self) -> None:
        with live_server() as server:
            for _ in range(3):
                response = _post(server, f"{FILE_NAME_MARKER}.txt", CONTENT_MARKER.encode())
                assert response.status_code == 200
            assert _post(server, "x.unknownext", b"zz").status_code == 400
            time.sleep(0.2)
            stderr = server.stderr()
        lines = [line for line in stderr.splitlines() if "extract format=" in line]
        assert len(lines) == 4, stderr
        for line in lines:
            for field in ("format=", "size=", "duration_ms=", "result=", "child_peak_rss_mb="):
                assert field in line
        assert sum("result=ok" in line for line in lines) == 3
        assert "forkserver started" in stderr
        assert CONTENT_MARKER not in stderr
        assert FILE_NAME_MARKER not in stderr
        assert TOKEN not in stderr

    def test_log_level_is_honoured(self) -> None:
        with live_server({"LOG_LEVEL": "WARNING"}) as server:
            assert _post(server, "a.txt", b"quiet").status_code == 200
            time.sleep(0.2)
            stderr = server.stderr()
        assert "extract format=" not in stderr
