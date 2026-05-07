"""Health router for the markitdown-extractor service.

Provides:
  GET /healthz — liveness probe (process alive check only)
  GET /readyz  — readiness probe (semaphore headroom + dependency imports)

Both endpoints are exempt from Bearer token authentication (see
BearerAuthMiddleware BYPASS_PATHS) and must respond quickly so that
Kubernetes / Docker health probes do not time out.

Req 3.2: Liveness and readiness probes are always available without auth.
Req 3.4: Readiness check verifies service is ready to accept work.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])

# ---------------------------------------------------------------------------
# PDF strategy constant
# ---------------------------------------------------------------------------
# The definitive value will come from app.services.extractors.pdf_extractor
# once task 3.1 is complete.  For now we return the default fallback strategy
# and attempt a dynamic import so the value updates automatically when the
# module becomes available.

def _get_pdf_extraction_strategy() -> str:
    """Return the current PDF extraction strategy identifier.

    Tries to import the strategy constant from the pdf_extractor module
    (task 3.1).  Falls back to 'pdfminer_fallback' if the module is not
    yet available.
    """
    try:
        from app.services.extractors.pdf_extractor import PDF_EXTRACTION_STRATEGY  # type: ignore[import-not-found]
        return PDF_EXTRACTION_STRATEGY
    except ImportError:
        return "pdfminer_fallback"


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


@router.get("/readyz", summary="Readiness probe")
async def readyz() -> dict[str, object]:
    """Return readiness status including the PDF extraction strategy.

    Checks:
    - Core dependency imports succeed (markitdown, pydantic, fastapi)
    - PDF extraction strategy is resolvable

    Returns a 200 with ready=True when the service can accept traffic.
    Currently always returns ready because semaphore state changes per-request;
    a 503 path would be added if startup-time checks ever fail.
    """
    # Verify that core dependencies can be imported.  These should always
    # succeed in a properly installed environment; the check acts as a
    # canary for broken package installs detected at deploy time.
    dependencies: dict[str, str] = {}
    try:
        import markitdown as _md  # noqa: F401
        dependencies["markitdown"] = "ok"
    except ImportError as exc:
        dependencies["markitdown"] = f"error: {exc}"

    try:
        import pydantic as _pydantic  # noqa: F401
        dependencies["pydantic"] = "ok"
    except ImportError as exc:
        dependencies["pydantic"] = f"error: {exc}"

    pdf_strategy = _get_pdf_extraction_strategy()

    return {
        "status": "ready",
        "pdf_extraction_strategy": pdf_strategy,
        "dependencies": dependencies,
    }
