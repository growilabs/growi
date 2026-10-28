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

from io import BytesIO
from pathlib import Path

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
    """POST /extract — authenticated requests reach the intake path."""

    def test_extract_with_auth_returns_temporary_503(self, client, test_token) -> None:
        """Until the runner is wired, a valid request gets 503 (extraction_failed)."""
        sample_bytes = (FIXTURES_DIR / "sample.txt").read_bytes()
        response = client.post(
            "/extract",
            headers={"Authorization": f"Bearer {test_token}"},
            files={"file": ("sample.txt", BytesIO(sample_bytes), "text/plain")},
        )
        assert response.status_code == 503
        assert response.json()["code"] == "extraction_failed"
