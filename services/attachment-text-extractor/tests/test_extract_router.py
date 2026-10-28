"""Tests for the extract router (POST /extract).

Covers Bearer auth, the slot and size checks, and the mapping from the runner's outcome to
the response (design.md "Error Categories and Responses").
"""

from __future__ import annotations

import asyncio
import json
import logging
from io import BytesIO
from pathlib import Path
from typing import get_args
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.conversion.errors import ConversionFailure, FailureKind
from app.conversion.results import ConversionOutcome, ConversionSuccess
from app.limits import Limits
from app.middleware.bearer_auth import BearerAuthMiddleware
from app.routers import extract as extract_module
from app.routers.extract import router as extract_router
from app.routers.health import router as health_router
from app.runner import ConversionRequest
from app.schemas import PageInfo

FIXTURES_DIR = Path(__file__).parent / "fixtures"
TEST_TOKEN = "test-extract-token"
CONTENT_MARKER = b"SECRET-FILE-CONTENT-MARKER"
FILENAME_MARKER = "SECRET-FILENAME-MARKER"


class FakeRunner:
    """Stands in for ConversionRunner: returns a canned outcome or raises, and records the requests."""

    def __init__(self, outcome: ConversionOutcome | BaseException | None = None) -> None:
        self.outcome: ConversionOutcome | BaseException = outcome or _success()
        self.requests: list[ConversionRequest] = []

    async def run(self, request: ConversionRequest) -> ConversionOutcome:
        self.requests.append(request)
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return self.outcome


def _success(content: str = "hello", rss: int | None = 42) -> ConversionSuccess:
    return ConversionSuccess(
        pages=[PageInfo(pageNumber=1, label="1", content=content)], mime_type="text/plain", child_peak_rss_mb=rss
    )


def _failure(kind: FailureKind) -> ConversionFailure:
    return ConversionFailure(kind=kind, detail="internal detail that must not leak", child_peak_rss_mb=7)


def make_limits(*, max_file_size_mb: int = 10, max_concurrency: int = 2) -> Limits:
    return Limits(max_file_size_mb=max_file_size_mb, max_concurrency=max_concurrency, upload_timeout_s=15)


def create_extract_test_app(runner: object | None = None, limits: Limits | None = None) -> FastAPI:
    """Minimal app with health + extract routers and auth middleware (what the lifespan would set up)."""
    app = FastAPI()
    app.include_router(health_router)
    app.include_router(extract_router)
    app.add_middleware(BearerAuthMiddleware, token=TEST_TOKEN)
    app.state.runner = runner
    app.state.limits = limits or make_limits()
    return app


@pytest.fixture()
def runner() -> FakeRunner:
    return FakeRunner()


@pytest.fixture()
def limits() -> Limits:
    return make_limits()


@pytest.fixture()
def extract_client(runner: FakeRunner, limits: Limits):
    """TestClient for the extract-router test app."""
    app = create_extract_test_app(runner, limits)
    with TestClient(app, raise_server_exceptions=True) as tc:
        yield tc


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TEST_TOKEN}"}


@pytest.fixture()
def sample_txt_bytes() -> bytes:
    return (FIXTURES_DIR / "sample.txt").read_bytes()


def _post(client: TestClient, headers: dict[str, str], data: bytes = b"hello", name: str = "sample.txt", **form: str):
    return client.post("/extract", headers=headers, files={"file": (name, BytesIO(data), "text/plain")}, data=form)


class TestExtractSuccess:
    def test_success_returns_pages_and_forwards_upload(
        self, extract_client: TestClient, auth_headers: dict[str, str], runner: FakeRunner
    ) -> None:
        response = _post(extract_client, auth_headers, b"payload", "a.txt", mimeType="text/plain")
        assert response.status_code == 200
        assert response.json() == {
            "pages": [{"pageNumber": 1, "label": "1", "content": "hello"}],
            "mimeType": "text/plain",
            "extractedCharacters": 5,
        }
        assert runner.requests == [ConversionRequest(data=b"payload", filename="a.txt", mime_hint="text/plain")]

    def test_extracted_characters_sums_all_pages(
        self, extract_client: TestClient, auth_headers: dict[str, str], runner: FakeRunner
    ) -> None:
        runner.outcome = ConversionSuccess(
            pages=[PageInfo(pageNumber=1, label="1", content="abc"), PageInfo(pageNumber=2, label="2", content="de")],
            mime_type="application/pdf",
        )
        assert _post(extract_client, auth_headers).json()["extractedCharacters"] == 5

    def test_non_ascii_content_is_returned_as_utf8_json(
        self, extract_client: TestClient, auth_headers: dict[str, str], runner: FakeRunner
    ) -> None:
        runner.outcome = _success(content="日本語の本文 🎉")
        response = _post(extract_client, auth_headers)
        assert response.status_code == 200
        assert json.loads(response.content.decode("utf-8"))["pages"][0]["content"] == "日本語の本文 🎉"


EXPECTED_MAPPING: dict[str, tuple[int, str]] = {
    "unsupported": (400, "unsupported_format"),
    "encrypted": (422, "file_encrypted"),
    "malformed": (422, "extraction_failed"),
    "limit_exceeded": (422, "resource_limit_exceeded"),
    "memory_exceeded": (422, "resource_limit_exceeded"),
    "result_too_large": (422, "resource_limit_exceeded"),
    "timeout": (408, "extraction_timeout"),
    "crashed": (500, "extraction_failed"),
    "internal": (500, "extraction_failed"),
}


class TestFailureMapping:
    @pytest.mark.parametrize("kind", get_args(FailureKind))
    def test_every_failure_kind_maps_per_design_table(
        self, kind: FailureKind, extract_client: TestClient, auth_headers: dict[str, str], runner: FakeRunner
    ) -> None:
        # A new FailureKind has no row in EXPECTED_MAPPING and fails here until the design table is extended.
        status, code = EXPECTED_MAPPING[kind]
        runner.outcome = _failure(kind)
        response = _post(extract_client, auth_headers)
        assert response.status_code == status
        body = response.json()
        assert body["code"] == code
        assert "internal detail" not in body["message"]

    def test_expected_mapping_covers_exactly_the_failure_kinds(self) -> None:
        assert set(EXPECTED_MAPPING) == set(get_args(FailureKind))


class TestSlotRelease:
    @pytest.fixture()
    def one_slot(self) -> Limits:
        return make_limits(max_file_size_mb=1, max_concurrency=1)

    @pytest.fixture()
    def limits(self, one_slot: Limits) -> Limits:
        return one_slot

    @pytest.mark.parametrize("kind", ["timeout", "crashed"])
    def test_next_request_gets_a_slot_after_failure(
        self,
        kind: FailureKind,
        one_slot: Limits,
        extract_client: TestClient,
        auth_headers: dict[str, str],
        runner: FakeRunner,
    ) -> None:
        runner.outcome = _failure(kind)
        assert _post(extract_client, auth_headers).status_code in (408, 500)
        runner.outcome = _success()
        assert _post(extract_client, auth_headers).status_code == 200

    def test_slot_is_released_when_the_runner_raises(self, one_slot: Limits, auth_headers: dict[str, str]) -> None:
        runner = FakeRunner(RuntimeError("boom"))
        with TestClient(create_extract_test_app(runner, one_slot), raise_server_exceptions=False) as client:
            response = _post(client, auth_headers)
            assert response.status_code == 500
            assert response.json()["code"] == "extraction_failed"
            runner.outcome = _success()
            assert _post(client, auth_headers).status_code == 200

    def test_slot_is_released_when_the_request_is_cancelled(self, one_slot: Limits) -> None:
        async def scenario() -> None:
            started = asyncio.Event()

            class Hanging:
                async def run(self, request: ConversionRequest) -> ConversionOutcome:
                    started.set()
                    await asyncio.sleep(60)
                    raise AssertionError("unreachable")

            async def handler() -> None:
                async with one_slot.acquire_slot():
                    await Hanging().run(ConversionRequest(b"", "a.txt", None))

            task = asyncio.create_task(handler())
            await started.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            async with one_slot.acquire_slot():
                pass

        asyncio.run(scenario())

    def test_cancelled_runner_inside_the_router_releases_the_slot(
        self, one_slot: Limits, auth_headers: dict[str, str]
    ) -> None:
        runner = FakeRunner(asyncio.CancelledError())
        with TestClient(create_extract_test_app(runner, one_slot), raise_server_exceptions=False) as client:
            try:
                _post(client, auth_headers)
            except BaseException:  # noqa: BLE001, S110 — the cancelled request may surface in any form
                pass
            runner.outcome = _success()
            assert _post(client, auth_headers).status_code == 200


class TestLogging:
    def test_one_line_per_request_without_content_filename_or_token(
        self,
        extract_client: TestClient,
        auth_headers: dict[str, str],
        runner: FakeRunner,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        runner.outcome = _success(content=CONTENT_MARKER.decode())
        with caplog.at_level(logging.DEBUG):
            _post(extract_client, auth_headers, CONTENT_MARKER, f"{FILENAME_MARKER}.txt")
        records = [r for r in caplog.records if r.name == extract_module.logger.name]
        assert len(records) == 1
        line = records[0].getMessage()
        for field in ("format=", "size=", "duration_ms=", "result=ok", "child_peak_rss_mb=42"):
            assert field in line
        assert f"size={len(CONTENT_MARKER)}" in line
        everything = caplog.text
        assert CONTENT_MARKER.decode() not in everything
        assert FILENAME_MARKER not in everything
        assert TEST_TOKEN not in everything

    def test_failure_line_has_kind_and_rss(
        self,
        extract_client: TestClient,
        auth_headers: dict[str, str],
        runner: FakeRunner,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        runner.outcome = _failure("memory_exceeded")
        with caplog.at_level(logging.INFO):
            _post(extract_client, auth_headers)
        line = next(r.getMessage() for r in caplog.records if r.name == extract_module.logger.name)
        assert "result=memory_exceeded" in line
        assert "child_peak_rss_mb=7" in line
        assert "internal detail" not in caplog.text


class TestExtractAuth:
    """Bearer auth enforcement on POST /extract."""

    def test_no_auth_returns_401(self, extract_client: TestClient, sample_txt_bytes: bytes) -> None:
        response = extract_client.post(
            "/extract",
            files={"file": ("sample.txt", BytesIO(sample_txt_bytes), "text/plain")},
        )
        assert response.status_code == 401

    def test_wrong_token_returns_401(self, extract_client: TestClient, sample_txt_bytes: bytes) -> None:
        response = extract_client.post(
            "/extract",
            headers={"Authorization": "Bearer wrong-token"},
            files={"file": ("sample.txt", BytesIO(sample_txt_bytes), "text/plain")},
        )
        assert response.status_code == 401

    def test_401_body_has_code(self, extract_client: TestClient, sample_txt_bytes: bytes) -> None:
        response = extract_client.post(
            "/extract",
            files={"file": ("sample.txt", BytesIO(sample_txt_bytes), "text/plain")},
        )
        assert response.json().get("code") == "unauthorized"


class TestIntakeLimits:
    def test_file_too_large_returns_413_without_calling_runner(
        self,
        extract_client: TestClient,
        auth_headers: dict[str, str],
        runner: FakeRunner,
    ) -> None:
        client = TestClient(create_extract_test_app(runner, make_limits(max_file_size_mb=1)))
        response = _post(client, auth_headers, b"x" * (1024 * 1024 + 1))
        assert response.status_code == 413
        assert response.json()["code"] == "file_too_large"
        assert runner.requests == []

    def test_service_busy_returns_503_without_calling_runner(
        self, extract_client: TestClient, auth_headers: dict[str, str], runner: FakeRunner
    ) -> None:
        from contextlib import asynccontextmanager

        from app.limits import ServiceBusyError

        @asynccontextmanager
        async def busy_slot(self_):
            raise ServiceBusyError("busy")
            yield  # unreachable — needed for asynccontextmanager

        with patch("app.limits.Limits.acquire_slot", busy_slot):
            response = _post(extract_client, auth_headers)
        assert response.status_code == 503
        assert response.json()["code"] == "service_busy"
        assert runner.requests == []

    def test_file_at_the_limit_is_accepted(self, auth_headers: dict[str, str], runner: FakeRunner) -> None:
        client = TestClient(create_extract_test_app(runner, make_limits(max_file_size_mb=1)))
        assert _post(client, auth_headers, b"x" * (1024 * 1024)).status_code == 200
        assert len(runner.requests[0].data) == 1024 * 1024

    def test_empty_mime_type_field_means_no_hint(
        self, extract_client: TestClient, auth_headers: dict[str, str], runner: FakeRunner
    ) -> None:
        assert _post(extract_client, auth_headers, mimeType="").status_code == 200
        assert runner.requests[0].mime_hint is None


def _assert_invalid_upload(response, *, not_echoed: str | None = None) -> None:  # noqa: ANN001
    assert response.status_code == 422
    body = response.json()
    assert set(body) == {"code", "message"}
    assert body["code"] == "extraction_failed"
    assert len(response.content) < 512
    if not_echoed is not None:
        assert not_echoed not in response.text


class TestInvalidUploads:
    """A request that is not a multipart form with one `file` part never echoes its input."""

    def test_missing_file_returns_422(self, extract_client: TestClient, auth_headers: dict[str, str]) -> None:
        response = extract_client.post("/extract", headers=auth_headers, data={"mimeType": "text/plain"})
        _assert_invalid_upload(response)

    def test_file_sent_as_a_plain_field_is_422_without_echo(
        self, extract_client: TestClient, auth_headers: dict[str, str], runner: FakeRunner
    ) -> None:
        marker = CONTENT_MARKER.decode()
        response = extract_client.post("/extract", headers=auth_headers, files={"file": (None, marker)})
        _assert_invalid_upload(response, not_echoed=marker)
        assert runner.requests == []

    def test_large_plain_file_field_is_422_without_echo(
        self, extract_client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        marker = CONTENT_MARKER.decode() * (2 * 1024 * 1024 // len(CONTENT_MARKER))
        response = extract_client.post("/extract", headers=auth_headers, files={"file": (None, marker)})
        _assert_invalid_upload(response, not_echoed=CONTENT_MARKER.decode())

    def test_non_multipart_body_is_422(self, extract_client: TestClient, auth_headers: dict[str, str]) -> None:
        response = extract_client.post("/extract", headers=auth_headers, json={"file": CONTENT_MARKER.decode()})
        _assert_invalid_upload(response, not_echoed=CONTENT_MARKER.decode())

    def test_broken_multipart_body_is_422(self, extract_client: TestClient, auth_headers: dict[str, str]) -> None:
        headers = {**auth_headers, "Content-Type": "multipart/form-data; boundary=xyz"}
        response = extract_client.post("/extract", headers=headers, content=b"--xyz\r\ngarbage-without-headers")
        _assert_invalid_upload(response)

    def test_two_file_parts_are_422(self, extract_client: TestClient, auth_headers: dict[str, str]) -> None:
        files = [("file", ("a.txt", b"a")), ("file", ("b.txt", b"b"))]
        _assert_invalid_upload(extract_client.post("/extract", headers=auth_headers, files=files))

    def test_long_file_name_is_accepted(
        self, extract_client: TestClient, auth_headers: dict[str, str], runner: FakeRunner
    ) -> None:
        name = "n" * 1000 + ".txt"
        assert _post(extract_client, auth_headers, b"payload", name).status_code == 200
        assert runner.requests[0].filename == name

    def test_part_header_over_the_parser_limit_is_422_with_an_error_code(
        self, extract_client: TestClient, auth_headers: dict[str, str], runner: FakeRunner
    ) -> None:
        # python-multipart caps one part header at about 4 KiB.
        name = FILENAME_MARKER + "n" * 5000 + ".txt"
        _assert_invalid_upload(_post(extract_client, auth_headers, b"payload", name), not_echoed=FILENAME_MARKER)
        assert runner.requests == []
