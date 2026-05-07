"""Unit tests for BearerAuthMiddleware (Task 2.2).

Validates:
- Correct token → 200, handler is reached
- Missing Authorization header → 401 unauthorized (before size check / semaphore)
- Wrong token → 401 unauthorized
- Bearer prefix present but no token value → 401
- GET /healthz, GET /readyz, GET /openapi.json without auth → 200 (bypass paths)
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.testclient import TestClient

# ---------------------------------------------------------------------------
# Minimal FastAPI test app — isolates middleware without requiring app.main
# ---------------------------------------------------------------------------


def _make_test_app(token: str) -> FastAPI:
    """Build a minimal FastAPI app with BearerAuthMiddleware applied."""
    from app.middleware.bearer_auth import BearerAuthMiddleware

    app = FastAPI()
    app.add_middleware(BearerAuthMiddleware, token=token)

    @app.post("/extract")
    async def extract_endpoint(request: Request) -> JSONResponse:  # noqa: RUF029
        return JSONResponse({"reached": True}, status_code=200)

    @app.get("/healthz")
    async def healthz() -> JSONResponse:  # noqa: RUF029
        return JSONResponse({"status": "ok"}, status_code=200)

    @app.get("/readyz")
    async def readyz() -> JSONResponse:  # noqa: RUF029
        return JSONResponse({"status": "ready"}, status_code=200)

    @app.get("/openapi.json")
    async def openapi() -> JSONResponse:  # noqa: RUF029
        return JSONResponse({"openapi": "3.1.0"}, status_code=200)

    return app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def auth_client(test_token: str) -> TestClient:
    """TestClient wrapping the minimal app configured with the test token."""
    app = _make_test_app(test_token)
    with TestClient(app, raise_server_exceptions=True) as client:
        yield client


# ---------------------------------------------------------------------------
# Tests: POST /extract — authentication required
# ---------------------------------------------------------------------------


class TestExtractAuthentication:
    """POST /extract must enforce Bearer token authentication."""

    def test_correct_token_reaches_handler(self, auth_client: TestClient, test_token: str) -> None:
        """A request with the correct Bearer token must receive 200 from the handler."""
        response = auth_client.post(
            "/extract",
            headers={"Authorization": f"Bearer {test_token}"},
        )
        assert response.status_code == 200
        assert response.json() == {"reached": True}

    def test_missing_authorization_header_returns_401(self, auth_client: TestClient) -> None:
        """A request without any Authorization header must be rejected with 401."""
        response = auth_client.post("/extract")
        assert response.status_code == 401
        body = response.json()
        assert body["code"] == "unauthorized"

    def test_wrong_token_returns_401(self, auth_client: TestClient) -> None:
        """A request with an incorrect token must be rejected with 401."""
        response = auth_client.post(
            "/extract",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401
        body = response.json()
        assert body["code"] == "unauthorized"

    def test_bearer_prefix_without_token_returns_401(self, auth_client: TestClient) -> None:
        """'Authorization: Bearer ' (with no token after the space) must return 401."""
        response = auth_client.post(
            "/extract",
            headers={"Authorization": "Bearer "},
        )
        assert response.status_code == 401
        body = response.json()
        assert body["code"] == "unauthorized"

    def test_non_bearer_scheme_returns_401(self, auth_client: TestClient, test_token: str) -> None:
        """Using a non-Bearer scheme (e.g. Basic) must be rejected with 401."""
        response = auth_client.post(
            "/extract",
            headers={"Authorization": f"Basic {test_token}"},
        )
        assert response.status_code == 401
        body = response.json()
        assert body["code"] == "unauthorized"

    def test_error_response_has_message_field(self, auth_client: TestClient) -> None:
        """The 401 response body must contain a human-readable 'message' field."""
        response = auth_client.post("/extract")
        body = response.json()
        assert "message" in body
        assert isinstance(body["message"], str)
        assert len(body["message"]) > 0

    def test_401_returned_before_handler_processing(self, auth_client: TestClient) -> None:
        """With a wrong token the handler must not be reached (response body differs from handler)."""
        response = auth_client.post(
            "/extract",
            headers={"Authorization": "Bearer invalid"},
        )
        assert response.status_code == 401
        # If the handler were reached it would return {"reached": True}
        assert response.json() != {"reached": True}


# ---------------------------------------------------------------------------
# Tests: bypass paths — no auth required
# ---------------------------------------------------------------------------


class TestBypassPaths:
    """GET /healthz, /readyz, and /openapi.json must be accessible without authentication."""

    def test_healthz_bypasses_auth(self, auth_client: TestClient) -> None:
        """GET /healthz without Authorization header must return 200."""
        response = auth_client.get("/healthz")
        assert response.status_code == 200

    def test_readyz_bypasses_auth(self, auth_client: TestClient) -> None:
        """GET /readyz without Authorization header must return 200."""
        response = auth_client.get("/readyz")
        assert response.status_code == 200

    def test_openapi_json_bypasses_auth(self, auth_client: TestClient) -> None:
        """GET /openapi.json without Authorization header must return 200."""
        response = auth_client.get("/openapi.json")
        assert response.status_code == 200


# ---------------------------------------------------------------------------
# Tests: middleware can be imported and instantiated independently
# ---------------------------------------------------------------------------


class TestMiddlewareImport:
    """BearerAuthMiddleware must be importable and instantiable."""

    def test_module_importable(self) -> None:
        """app.middleware.bearer_auth must be importable without error."""
        import app.middleware.bearer_auth  # noqa: F401

    def test_class_importable(self) -> None:
        """BearerAuthMiddleware must be importable from app.middleware.bearer_auth."""
        from app.middleware.bearer_auth import BearerAuthMiddleware  # noqa: F401

        assert BearerAuthMiddleware is not None

    def test_bypass_paths_constant_importable(self) -> None:
        """BYPASS_PATHS set must be importable and contain the three required paths."""
        from app.middleware.bearer_auth import BYPASS_PATHS

        assert "/healthz" in BYPASS_PATHS
        assert "/readyz" in BYPASS_PATHS
        assert "/openapi.json" in BYPASS_PATHS
