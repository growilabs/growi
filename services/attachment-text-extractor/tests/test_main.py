"""Integration tests for the FastAPI app factory (app.main).

Task 4.3 completion criteria:
- GET /healthz → 200 (no auth required)
- GET /readyz  → 200 with status and dependencies (no auth required)
- GET /openapi.json → 200 with ExtractResponse schema (no auth required)
- POST /extract without auth → 401
- POST /extract with auth reaches the slot/size checks (503 until the runner is wired)

Uses the ``client`` fixture from conftest.py which lazily imports ``app.main:app``
and skips all tests here if main.py does not exist yet.

Requirements: 1.1, 3.3, 3.4
"""

from __future__ import annotations

import os
import signal
import time
from io import BytesIO
from pathlib import Path

from starlette.testclient import TestClient

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestHealthzIntegration:
    """GET /healthz via the full app stack."""

    def test_healthz_returns_200(self, client) -> None:
        """Liveness probe must return 200 without auth."""
        response = client.get("/healthz")
        assert response.status_code == 200

    def test_healthz_returns_status_ok(self, client) -> None:
        """Liveness probe must return {status: ok}."""
        response = client.get("/healthz")
        assert response.json() == {"status": "ok"}

    def test_healthz_no_auth_required(self, client) -> None:
        """Liveness probe must be reachable without Authorization header."""
        response = client.get("/healthz")
        assert response.status_code == 200

    def test_healthz_invalid_auth_still_200(self, client) -> None:
        """Invalid auth header must not block the liveness probe."""
        response = client.get("/healthz", headers={"Authorization": "Bearer wrong"})
        assert response.status_code == 200


class TestReadyzIntegration:
    """GET /readyz via the full app stack."""

    def test_readyz_returns_200(self, client) -> None:
        """Readiness probe must return 200 without auth."""
        response = client.get("/readyz")
        assert response.status_code == 200

    def test_readyz_returns_status_ready(self, client) -> None:
        """Readiness probe body must include status=ready."""
        response = client.get("/readyz")
        assert response.json()["status"] == "ready"

    def test_readyz_has_no_pdf_strategy(self, client) -> None:
        """The removed PDF strategy field must not appear in readyz."""
        body = client.get("/readyz").json()
        assert "pdf_extraction_strategy" not in body
        assert "pdf_strategy" not in body

    def test_readyz_no_auth_required(self, client) -> None:
        """Readiness probe must be reachable without Authorization header."""
        response = client.get("/readyz")
        assert response.status_code == 200


class TestOpenApiIntegration:
    """GET /openapi.json via the full app stack."""

    def test_openapi_returns_200(self, client) -> None:
        """OpenAPI schema endpoint must return 200 without auth (bypass path)."""
        response = client.get("/openapi.json")
        assert response.status_code == 200

    def test_openapi_contains_extract_response_schema(self, client) -> None:
        """OpenAPI schema must include the ExtractResponse Pydantic model."""
        response = client.get("/openapi.json")
        body = response.json()
        # FastAPI auto-generates schemas from Pydantic models under components/schemas
        schemas = body.get("components", {}).get("schemas", {})
        assert "ExtractResponse" in schemas, f"ExtractResponse not found in OpenAPI schemas: {list(schemas.keys())}"

    def test_openapi_contains_extract_endpoint(self, client) -> None:
        """OpenAPI schema must declare the /extract POST endpoint."""
        response = client.get("/openapi.json")
        body = response.json()
        paths = body.get("paths", {})
        assert "/extract" in paths
        assert "post" in paths["/extract"]

    def test_openapi_openapi_version_is_3x(self, client) -> None:
        """OpenAPI schema must declare a 3.x version."""
        response = client.get("/openapi.json")
        body = response.json()
        openapi_version = body.get("openapi", "")
        assert openapi_version.startswith("3.")

    def test_openapi_no_auth_required(self, client) -> None:
        """OpenAPI schema endpoint is a bypass path — no auth needed."""
        response = client.get("/openapi.json")
        assert response.status_code == 200


class TestExtractAuthIntegration:
    """POST /extract — authentication enforcement via the full app stack."""

    def test_extract_without_auth_returns_401(self, client) -> None:
        """Request without Authorization header must be rejected with 401."""
        sample_bytes = (FIXTURES_DIR / "sample.txt").read_bytes()
        response = client.post(
            "/extract",
            files={"file": ("sample.txt", BytesIO(sample_bytes), "text/plain")},
        )
        assert response.status_code == 401

    def test_extract_with_wrong_token_returns_401(self, client) -> None:
        """Request with an incorrect Bearer token must be rejected with 401."""
        sample_bytes = (FIXTURES_DIR / "sample.txt").read_bytes()
        response = client.post(
            "/extract",
            headers={"Authorization": "Bearer wrong-token"},
            files={"file": ("sample.txt", BytesIO(sample_bytes), "text/plain")},
        )
        assert response.status_code == 401

    def test_extract_401_body_has_unauthorized_code(self, client) -> None:
        """Rejected requests must carry {code: unauthorized} in the body."""
        sample_bytes = (FIXTURES_DIR / "sample.txt").read_bytes()
        response = client.post(
            "/extract",
            files={"file": ("sample.txt", BytesIO(sample_bytes), "text/plain")},
        )
        body = response.json()
        assert body.get("code") == "unauthorized"


class TestExtractIntakeIntegration:
    """POST /extract — authenticated requests reach the real runner started by the lifespan."""

    def test_extract_with_auth_returns_pages(self, client, test_token) -> None:
        """An authenticated upload is converted in a real child process."""
        response = client.post(
            "/extract",
            headers={"Authorization": f"Bearer {test_token}"},
            files={"file": ("sample.txt", b"hello lifespan", "text/plain")},
        )
        assert response.status_code == 200
        assert "hello lifespan" in response.json()["pages"][0]["content"]


def _create_app(**runner_options):  # noqa: ANN003, ANN202
    # Deferred: importing app.main builds the module-level app, which needs the token env var.
    from app.main import create_app

    return create_app(**runner_options)


def _alive(pid: int) -> bool:
    # A killed forkserver stays a zombie (it is our child) until reaped; that is not running.
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
    except FileNotFoundError:
        return False
    return stat.rsplit(")", 1)[1].split()[0] != "Z"


def _wait_gone(pid: int, timeout_s: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not _alive(pid):
            return True
        time.sleep(0.05)
    return False


class TestLifespan:
    """The app starts the forkserver before serving and stops it on shutdown (Req 3.2, 3.4)."""

    def test_readyz_is_ready_with_dependencies_loaded(self, client) -> None:
        response = client.get("/readyz")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ready"
        assert set(body["dependencies"]) == {"anydoc", "pypdfium2", "charset-normalizer", "converter"}
        assert set(body["dependencies"].values()) == {"ok"}

    def test_readyz_exposes_no_internal_module_names(self, client) -> None:
        assert "app.runner" not in client.get("/readyz").text

    def test_runner_is_stored_on_app_state_before_serving(self, client) -> None:
        assert client.app.state.runner.is_ready()

    def test_forkserver_is_stopped_on_shutdown(self, test_token) -> None:
        app = _create_app()
        with TestClient(app) as tc:
            assert tc.get("/readyz").status_code == 200
            pid = app.state.runner.readiness().forkserver_pid
            assert pid is not None
            assert _alive(pid)
        assert _wait_gone(pid), "forkserver still running after the lifespan ended"
        assert not app.state.runner.is_ready()

    def test_killed_forkserver_is_healed_by_the_next_readyz(self, test_token) -> None:
        """readiness() reads the dead forkserver as stale, so readyz re-verifies, which restarts it."""
        app = _create_app()
        with TestClient(app) as tc:
            old_pid = app.state.runner.readiness().forkserver_pid
            os.kill(old_pid, signal.SIGKILL)
            assert _wait_gone(old_pid)
            assert app.state.runner.readiness().stale
            response = tc.get("/readyz")
            assert response.status_code == 200
            new_pid = app.state.runner.readiness().forkserver_pid
            assert new_pid != old_pid
        assert _wait_gone(new_pid)

    def test_missing_dependency_boots_not_ready_and_readyz_gives_503(self, test_token) -> None:
        """A forkserver that cannot load a dependency never aborts startup; liveness stays ok."""
        app = _create_app(dependencies=("anydoc", "no_such_module_for_readiness_test"), probe_timeout_s=2.0)
        with TestClient(app) as tc:
            assert tc.get("/healthz").json() == {"status": "ok"}
            began = time.monotonic()
            response = tc.get("/readyz")
            assert time.monotonic() - began < 5.0
            assert response.status_code == 503
            body = response.json()
            assert body["status"] == "not_ready"
            assert body["dependencies"]["anydoc"] == "ok"
            assert body["dependencies"]["converter"] == "missing"
            assert "no_such_module" not in response.text
            pid = app.state.runner.readiness().forkserver_pid
        if pid is not None:
            assert _wait_gone(pid)
