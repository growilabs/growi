"""Tests for the extract router (POST /extract).

Task 4.2 completion criteria:
- POST /extract (multipart) returns 200 + ExtractResponse for TXT input
- Bearer auth is enforced (401 without token)
- Error cases map to correct HTTP status codes
"""

from __future__ import annotations

import os
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

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


class TestExtractHappyPath:
    """POST /extract — normal success cases."""

    def test_txt_returns_200(
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
        assert response.status_code == 200

    def test_txt_response_has_pages(
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
        body = response.json()
        assert "pages" in body
        assert isinstance(body["pages"], list)
        assert len(body["pages"]) >= 1

    def test_txt_response_has_mime_type(
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
        body = response.json()
        assert "mimeType" in body
        assert isinstance(body["mimeType"], str)

    def test_txt_response_has_extracted_characters(
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
        body = response.json()
        assert "extractedCharacters" in body
        assert isinstance(body["extractedCharacters"], int)
        assert body["extractedCharacters"] >= 0

    def test_extracted_characters_equals_sum_of_page_content_lengths(
        self,
        extract_client: TestClient,
        auth_headers: dict[str, str],
        sample_txt_bytes: bytes,
    ) -> None:
        """extractedCharacters must equal sum of all page content lengths."""
        response = extract_client.post(
            "/extract",
            headers=auth_headers,
            files={"file": ("sample.txt", BytesIO(sample_txt_bytes), "text/plain")},
        )
        body = response.json()
        total = sum(len(p["content"]) for p in body["pages"])
        assert body["extractedCharacters"] == total

    def test_txt_with_mime_hint(
        self,
        extract_client: TestClient,
        auth_headers: dict[str, str],
        sample_txt_bytes: bytes,
    ) -> None:
        """Optional mimeType parameter should be accepted."""
        response = extract_client.post(
            "/extract",
            headers=auth_headers,
            files={"file": ("sample.txt", BytesIO(sample_txt_bytes), "text/plain")},
            data={"mimeType": "text/plain"},
        )
        assert response.status_code == 200


class TestExtractAuth:
    """Bearer auth enforcement on POST /extract."""

    def test_no_auth_returns_401(
        self, extract_client: TestClient, sample_txt_bytes: bytes
    ) -> None:
        response = extract_client.post(
            "/extract",
            files={"file": ("sample.txt", BytesIO(sample_txt_bytes), "text/plain")},
        )
        assert response.status_code == 401

    def test_wrong_token_returns_401(
        self, extract_client: TestClient, sample_txt_bytes: bytes
    ) -> None:
        response = extract_client.post(
            "/extract",
            headers={"Authorization": "Bearer wrong-token"},
            files={"file": ("sample.txt", BytesIO(sample_txt_bytes), "text/plain")},
        )
        assert response.status_code == 401

    def test_401_body_has_code(
        self, extract_client: TestClient, sample_txt_bytes: bytes
    ) -> None:
        response = extract_client.post(
            "/extract",
            files={"file": ("sample.txt", BytesIO(sample_txt_bytes), "text/plain")},
        )
        body = response.json()
        assert body.get("code") == "unauthorized"


class TestExtractErrorCodes:
    """Error code → HTTP status mapping."""

    def test_unsupported_format_returns_400(
        self, extract_client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        """An unsupported file type triggers UnsupportedFormat → 400."""
        response = extract_client.post(
            "/extract",
            headers=auth_headers,
            files={"file": ("photo.bmp", BytesIO(b"\x00\x01\x02"), "image/bmp")},
        )
        assert response.status_code == 400
        body = response.json()
        assert body.get("code") == "unsupported_format"

    def test_file_too_large_returns_413(
        self, extract_client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        """A file exceeding MAX_FILE_SIZE_MB triggers FileTooLarge → 413."""
        from app.limits import FileTooLarge

        # Trigger lazy init by making a real request first (creates limits instance).
        # Then patch the Limits.enforce_size method on the class level.
        with patch("app.limits.Limits.enforce_size", side_effect=FileTooLarge("too big")):
            response = extract_client.post(
                "/extract",
                headers=auth_headers,
                files={"file": ("big.txt", BytesIO(b"x" * 10), "text/plain")},
            )
        assert response.status_code == 413
        body = response.json()
        assert body.get("code") == "file_too_large"

    def test_extraction_timeout_returns_408(
        self, extract_client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        """ExtractionTimeout → 408."""
        from app.limits import ExtractionTimeout

        with patch("app.limits.Limits.with_timeout", side_effect=ExtractionTimeout("timed out")):
            response = extract_client.post(
                "/extract",
                headers=auth_headers,
                files={"file": ("sample.txt", BytesIO(b"hello"), "text/plain")},
            )
        assert response.status_code == 408
        body = response.json()
        assert body.get("code") == "extraction_timeout"

    def test_service_busy_returns_503(
        self, extract_client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        """ServiceBusy → 503."""
        from app.limits import ServiceBusy
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def busy_slot(self_):
            raise ServiceBusy("busy")
            yield  # noqa: unreachable — needed for asynccontextmanager

        with patch("app.limits.Limits.acquire_slot", busy_slot):
            response = extract_client.post(
                "/extract",
                headers=auth_headers,
                files={"file": ("sample.txt", BytesIO(b"hello"), "text/plain")},
            )
        assert response.status_code == 503
        body = response.json()
        assert body.get("code") == "service_busy"

    def test_missing_file_returns_422(
        self, extract_client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        """Omitting the required `file` field returns 422 (FastAPI validation)."""
        response = extract_client.post(
            "/extract",
            headers=auth_headers,
            data={"mimeType": "text/plain"},
        )
        assert response.status_code == 422
