"""Health router for the attachment-text-extractor service.

Provides:
  GET /healthz — liveness probe (process alive check only)
  GET /readyz  — readiness probe (forkserver running + conversion dependencies loaded)

Both endpoints are exempt from Bearer token authentication (see
BearerAuthMiddleware BYPASS_PATHS) and must respond quickly so that
Kubernetes / Docker health probes do not time out.

Req 3.2: Liveness and readiness probes are always available without auth.
Req 3.4: Readiness check verifies service is ready to accept work.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping

from fastapi import APIRouter
from fastapi.requests import Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])

# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


@router.get("/healthz", summary="Liveness probe")
async def healthz() -> dict[str, str]:
    """Return 200 OK to confirm the process is alive.

    This handler intentionally does no dependency checking — it exists only
    to tell the orchestrator that the process has not crashed.
    """
    return {"status": "ok"}


# The probe result names internal modules (e.g. app.runner.child_entry); this endpoint is
# unauthenticated, so only the public dependency names are shown and the internal ones collapse
# into a single entry.
_PUBLIC_NAMES = {"anydoc": "anydoc", "pypdfium2": "pypdfium2", "charset_normalizer": "charset-normalizer"}
_INTERNAL_ENTRY = "converter"
_OK = "ok"


def _public_dependencies(statuses: Mapping[str, str]) -> dict[str, str]:
    shown = {_PUBLIC_NAMES[name]: status for name, status in statuses.items() if name in _PUBLIC_NAMES}
    internal = [status for name, status in statuses.items() if name not in _PUBLIC_NAMES]
    if internal:
        shown[_INTERNAL_ENTRY] = _OK if all(status == _OK for status in internal) else "missing"
    return shown


@router.get("/readyz", summary="Readiness probe")
async def readyz(request: Request) -> JSONResponse:
    """200 ``ready`` when the forkserver runs and has loaded the conversion dependencies, else 503.

    A not-ready cached state is re-verified (in a thread: it forks a probe child), so a pod that was
    taken out of service gets the call that brings it back. The body never carries paths or
    exception text.
    """
    runner = request.app.state.runner
    readiness = runner.readiness()
    if not readiness.ready:
        readiness = await asyncio.to_thread(runner.verify)
    body = {
        "status": "ready" if readiness.ready else "not_ready",
        "dependencies": _public_dependencies(readiness.dependencies),
    }
    return JSONResponse(body, status_code=200 if readiness.ready else 503)
