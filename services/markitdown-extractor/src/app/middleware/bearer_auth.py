"""Bearer token authentication middleware for the markitdown-extractor service.

Implements Req 3.3: All POST /extract requests must carry a valid
``Authorization: Bearer <token>`` header.  The token is compared using
``hmac.compare_digest`` to prevent timing attacks.

Bypass paths (no authentication required):
    - GET /healthz   — liveness probe
    - GET /readyz    — readiness probe
    - GET /openapi.json — OpenAPI schema endpoint

Rejected requests receive HTTP 401 with an ``ErrorResponse``-shaped JSON body
*before* any size checking or semaphore acquisition, ensuring that unauthenticated
traffic cannot trigger DoS-inducing resource allocation.

There is intentionally no ``ALLOW_UNAUTHENTICATED`` or similar opt-out mechanism.
"""

from __future__ import annotations

import hmac
import json

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Paths that are exempt from Bearer token verification.
BYPASS_PATHS: frozenset[str] = frozenset({"/healthz", "/readyz", "/openapi.json"})

_UNAUTHORIZED_BODY = json.dumps({"code": "unauthorized", "message": "Missing or invalid Bearer token"})


class BearerAuthMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that enforces Bearer token authentication.

    Must be added to the FastAPI app **before** any route handler so that
    authentication failures short-circuit the request pipeline before size
    checks or semaphore acquisitions occur.

    Args:
        app: The ASGI application to wrap.
        token: The expected Bearer token value (read from
            ``Settings.MARKITDOWN_SERVICE_TOKEN`` at startup).
    """

    def __init__(self, app, token: str) -> None:  # noqa: ANN001
        super().__init__(app)
        self._token = token

    async def dispatch(self, request: Request, call_next) -> Response:  # noqa: ANN001
        """Check the Authorization header; bypass probe and schema endpoints."""
        # Probe and schema paths are exempt from authentication.
        if request.url.path in BYPASS_PATHS:
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")

        # Must start with "Bearer " (note trailing space).
        if not auth_header.startswith("Bearer "):
            return _unauthorized_response()

        provided_token = auth_header[len("Bearer ") :]

        # Constant-time comparison prevents timing attacks.
        if not hmac.compare_digest(provided_token, self._token):
            return _unauthorized_response()

        return await call_next(request)


def _unauthorized_response() -> Response:
    """Return a 401 Unauthorized response with an ErrorResponse body."""
    return Response(
        content=_UNAUTHORIZED_BODY,
        status_code=401,
        media_type="application/json",
    )
