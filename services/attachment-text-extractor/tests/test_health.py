"""Tests for the health router (GET /healthz and GET /readyz).

Task 4.1 completion criteria:
- GET /healthz returns 200 with {"status": "ok"}
- GET /readyz returns 200 with status and dependencies
- Both endpoints require no authentication
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.middleware.bearer_auth import BearerAuthMiddleware
from app.routers.health import router as health_router

TEST_TOKEN = "test-health-token"


def create_health_test_app() -> FastAPI:
    """Minimal app with only the health router and auth middleware."""
    app = FastAPI()
    app.include_router(health_router)
    app.add_middleware(BearerAuthMiddleware, token=TEST_TOKEN)
    return app


@pytest.fixture()
def health_client():
    """TestClient for the health-router-only test app."""
    app = create_health_test_app()
    with TestClient(app, raise_server_exceptions=True) as tc:
        yield tc


class TestHealthz:
    """GET /healthz — liveness probe."""

    def test_returns_200(self, health_client: TestClient) -> None:
        response = health_client.get("/healthz")
        assert response.status_code == 200

    def test_returns_status_ok(self, health_client: TestClient) -> None:
        response = health_client.get("/healthz")
        assert response.json() == {"status": "ok"}

    def test_no_auth_required(self, health_client: TestClient) -> None:
        """No Authorization header should still return 200."""
        response = health_client.get("/healthz")
        assert response.status_code == 200

    def test_auth_header_ignored(self, health_client: TestClient) -> None:
        """Even an invalid auth header should not block the liveness probe."""
        response = health_client.get("/healthz", headers={"Authorization": "Bearer wrong-token"})
        assert response.status_code == 200


class TestReadyz:
    """GET /readyz — readiness probe."""

    def test_returns_200(self, health_client: TestClient) -> None:
        response = health_client.get("/readyz")
        assert response.status_code == 200

    def test_returns_status_ready(self, health_client: TestClient) -> None:
        response = health_client.get("/readyz")
        body = response.json()
        assert body["status"] == "ready"

    def test_does_not_contain_pdf_strategy(self, health_client: TestClient) -> None:
        """The removed PDF strategy fields must not appear in the readyz response."""
        body = health_client.get("/readyz").json()
        assert "pdf_extraction_strategy" not in body
        assert "pdf_strategy" not in body

    def test_no_auth_required(self, health_client: TestClient) -> None:
        """No Authorization header should still return 200."""
        response = health_client.get("/readyz")
        assert response.status_code == 200

    def test_contains_dependencies_field(self, health_client: TestClient) -> None:
        """dependencies field must be present in the readyz response."""
        response = health_client.get("/readyz")
        body = response.json()
        assert "dependencies" in body
