"""Tests for the extract router (POST /extract).

Covers the intake path of POST /extract:
- Bearer auth is enforced (401 without token)
- Slot and size errors map to 503 service_busy / 413 file_too_large
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.middleware.bearer_auth import BearerAuthMiddleware
from app.routers.extract import router as extract_router
from app.routers.health import router as health_router

FIXTURES_DIR = Path(__file__).parent / "fixtures"
TEST_TOKEN = "test-extract-token"


def create_extract_test_app() -> FastAPI:
    """Minimal app with health + extract routers and auth middleware."""
    app = FastAPI()
    app.include_router(health_router)
    app.include_router(extract_router)
    app.add_middleware(BearerAuthMiddleware, token=TEST_TOKEN)
    return app


@pytest.fixture()
def extract_client():
    """TestClient for the extract-router test app."""
    app = create_extract_test_app()
    with TestClient(app, raise_server_exceptions=True) as tc:
        yield tc


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TEST_TOKEN}"}


@pytest.fixture()
def sample_txt_bytes() -> bytes:
    return (FIXTURES_DIR / "sample.txt").read_bytes()


class TestExtractIntake:
    """POST /extract — behavior after the slot and size checks."""

    def test_valid_upload_returns_temporary_503(
        self,
        extract_client: TestClient,
        auth_headers: dict[str, str],
        sample_txt_bytes: bytes,
    ) -> None:
        response = extract_client.post(
            "/extract",
            headers=auth_headers,
            files={"file": ("sample.txt", BytesIO(sample_txt_bytes), "text/plain")},
        )
        assert response.status_code == 503
        assert response.json().get("code") == "extraction_failed"


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
        body = response.json()
        assert body.get("code") == "unauthorized"


class TestExtractErrorCodes:
    """Error code → HTTP status mapping."""

    def test_file_too_large_returns_413(self, extract_client: TestClient, auth_headers: dict[str, str]) -> None:
        """A file exceeding MAX_FILE_SIZE_MB triggers FileTooLargeError → 413."""
        from app.limits import FileTooLargeError

        # Trigger lazy init by making a real request first (creates limits instance).
        # Then patch the Limits.enforce_size method on the class level.
        with patch("app.limits.Limits.enforce_size", side_effect=FileTooLargeError("too big")):
            response = extract_client.post(
                "/extract",
                headers=auth_headers,
                files={"file": ("big.txt", BytesIO(b"x" * 10), "text/plain")},
            )
        assert response.status_code == 413
        body = response.json()
        assert body.get("code") == "file_too_large"

    def test_service_busy_returns_503(self, extract_client: TestClient, auth_headers: dict[str, str]) -> None:
        """ServiceBusyError → 503."""
        from contextlib import asynccontextmanager

        from app.limits import ServiceBusyError

        @asynccontextmanager
        async def busy_slot(self_):
            raise ServiceBusyError("busy")
            yield  # unreachable — needed for asynccontextmanager

        with patch("app.limits.Limits.acquire_slot", busy_slot):
            response = extract_client.post(
                "/extract",
                headers=auth_headers,
                files={"file": ("sample.txt", BytesIO(b"hello"), "text/plain")},
            )
        assert response.status_code == 503
        body = response.json()
        assert body.get("code") == "service_busy"

    def test_missing_file_returns_422(self, extract_client: TestClient, auth_headers: dict[str, str]) -> None:
        """Omitting the required `file` field returns 422 (FastAPI validation)."""
        response = extract_client.post(
            "/extract",
            headers=auth_headers,
            data={"mimeType": "text/plain"},
        )
        assert response.status_code == 422
