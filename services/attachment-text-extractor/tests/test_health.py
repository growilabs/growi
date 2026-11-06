"""Tests for the health router (GET /healthz and GET /readyz).

Task 4.1 completion criteria:
- GET /healthz returns 200 with {"status": "ok"}
- GET /readyz returns 200 with status and dependencies
- Both endpoints require no authentication
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.middleware.bearer_auth import BearerAuthMiddleware
from app.routers.health import router as health_router
from app.runner.conversion_runner import Readiness

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


class _ScriptedRunner:
    """Readiness source for the router: returns canned values and counts verify() calls."""

    def __init__(self, cached: Readiness, verified: Readiness) -> None:
        self._cached = cached
        self._verified = verified
        self.verify_calls = 0

    def readiness(self) -> Readiness:
        return self._cached

    def verify(self) -> Readiness:
        self.verify_calls += 1
        return self._verified


_ALL_OK = {"anydoc": "ok", "pypdfium2": "ok", "charset_normalizer": "ok", "app.runner.child_entry": "ok"}
_READY = Readiness(ready=True, dependencies=_ALL_OK, forkserver_pid=1)


def _client_with(runner: _ScriptedRunner):
    app = create_health_test_app()
    app.state.runner = runner
    return TestClient(app, raise_server_exceptions=True)


class TestReadyz:
    """GET /readyz — readiness probe."""

    def test_ready_returns_200_without_reprobing(self) -> None:
        runner = _ScriptedRunner(_READY, _READY)
        response = _client_with(runner).get("/readyz")
        assert response.status_code == 200
        assert response.json()["status"] == "ready"
        assert runner.verify_calls == 0

    def test_no_auth_required(self) -> None:
        response = _client_with(_ScriptedRunner(_READY, _READY)).get("/readyz")
        assert response.status_code == 200

    def test_not_ready_cache_is_reverified_and_the_new_answer_returned(self) -> None:
        stale = replace(_READY, ready=False, stale=True)
        runner = _ScriptedRunner(stale, _READY)
        response = _client_with(runner).get("/readyz")
        assert runner.verify_calls == 1
        assert response.status_code == 200
        assert response.json()["status"] == "ready"

    def test_still_not_ready_after_verify_returns_503(self) -> None:
        broken = Readiness(ready=False, dependencies={**_ALL_OK, "anydoc": "missing"})
        runner = _ScriptedRunner(Readiness(ready=False), broken)
        response = _client_with(runner).get("/readyz")
        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "not_ready"
        assert body["dependencies"]["anydoc"] == "missing"

    def test_dependencies_show_only_public_names(self) -> None:
        body = _client_with(_ScriptedRunner(_READY, _READY)).get("/readyz").json()
        assert body["dependencies"] == {
            "anydoc": "ok",
            "pypdfium2": "ok",
            "charset-normalizer": "ok",
            "converter": "ok",
        }
        assert "app.runner.child_entry" not in str(body)

    def test_internal_module_failure_shows_as_converter_missing(self) -> None:
        broken = Readiness(ready=False, dependencies={**_ALL_OK, "app.runner.child_entry": "missing"})
        body = _client_with(_ScriptedRunner(broken, broken)).get("/readyz").json()
        assert body["dependencies"]["converter"] == "missing"

    def test_does_not_contain_pdf_strategy(self) -> None:
        body = _client_with(_ScriptedRunner(_READY, _READY)).get("/readyz").json()
        assert "pdf_extraction_strategy" not in body
        assert "pdf_strategy" not in body
