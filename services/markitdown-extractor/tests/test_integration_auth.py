"""Integration tests for Bearer token authentication (Task 6.1).

Tests the full auth path through the real FastAPI app using the TestClient.
Requirements: 3.3
Boundary: ExtractRouter, BearerAuthMiddleware
"""

from __future__ import annotations


class TestAuthIntegration:
    """Test Bearer token enforcement on POST /extract."""

    def test_valid_token_reaches_extract(self, client, test_token):
        """Valid Bearer token should not return 401.

        A tiny TXT file with a correct token is accepted; it reaches the
        extraction handler and returns 200.
        """
        txt_content = b"hello world"
        resp = client.post(
            "/extract",
            headers={"Authorization": f"Bearer {test_token}"},
            files={"file": ("hello.txt", txt_content, "text/plain")},
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_missing_token_returns_401(self, client):
        """Request with no Authorization header must return 401.

        BearerAuthMiddleware rejects the request before any route handler runs.
        """
        resp = client.post(
            "/extract",
            files={"file": ("hello.txt", b"hello world", "text/plain")},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["code"] == "unauthorized"

    def test_wrong_token_returns_401(self, client):
        """Request with wrong token must return 401.

        Even if the header is syntactically valid, a wrong token value is
        rejected by constant-time comparison in BearerAuthMiddleware.
        """
        resp = client.post(
            "/extract",
            headers={"Authorization": "Bearer wrong-token-value"},
            files={"file": ("hello.txt", b"hello world", "text/plain")},
        )
        assert resp.status_code == 401
        body = resp.json()
        assert body["code"] == "unauthorized"

    def test_large_file_with_wrong_token_returns_401(self, client):
        """Auth check must happen before size check.

        A request carrying a wrong token must receive 401 regardless of file
        size, proving that BearerAuthMiddleware short-circuits the pipeline
        before the size limit is enforced.
        """
        # 20 MB of data — well above the default 10 MB limit.
        large_data = b"x" * (20 * 1024 * 1024)
        resp = client.post(
            "/extract",
            headers={"Authorization": "Bearer wrong-token-value"},
            files={"file": ("large.txt", large_data, "text/plain")},
        )
        # 401 must take precedence over 413.
        assert resp.status_code == 401
        body = resp.json()
        assert body["code"] == "unauthorized"


class TestPublicEndpoints:
    """Test that health and schema endpoints are accessible without authentication."""

    def test_healthz_no_auth(self, client):
        """GET /healthz must return 200 without any Authorization header."""
        resp = client.get("/healthz")
        assert resp.status_code == 200

    def test_readyz_no_auth(self, client):
        """GET /readyz must return 200 without any Authorization header."""
        resp = client.get("/readyz")
        assert resp.status_code == 200

    def test_openapi_no_auth(self, client):
        """GET /openapi.json must return 200 without any Authorization header."""
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
