"""FastAPI application factory for the markitdown-extractor service.

Startup sequence (Req 3.3, 3.4):
1. Load Settings — fail fast if MARKITDOWN_SERVICE_TOKEN is absent or empty.
2. Apply XXE hardening (defusedxml.defuse_stdlib()) before any XML is parsed.
3. Probe PDF extraction capability and cache the strategy as a module global.
4. Wire health and extract routers.
5. Add BearerAuthMiddleware (token from Settings).
6. Add a minimal structured JSON logging middleware (full format in task 4.4).
"""

from __future__ import annotations

import inspect
import json
import logging
import time

from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import Settings
from app.middleware.bearer_auth import BearerAuthMiddleware
from app.routers import extract, health
from app.security import apply_xxe_hardening

logger = logging.getLogger(__name__)

# Module-level cache for the PDF extraction strategy, populated at startup.
# Exposed at module level so the health router can read it when needed.
PDF_EXTRACTION_STRATEGY: str = "pdfminer_fallback"


def _probe_pdf_strategy() -> str:
    """Probe whether the installed markitdown supports per-page extraction.

    Inspects the signature of ``MarkItDown().convert_stream``.  If the
    ``extract_pages`` parameter is present the version supports per-page
    PDF extraction; otherwise fall back to pdfminer-based extraction.

    Returns:
        "markitdown" if ``extract_pages`` is present in the signature,
        "pdfminer_fallback" otherwise.
    """
    try:
        from markitdown import MarkItDown  # type: ignore[import-not-found]

        sig = inspect.signature(MarkItDown().convert_stream)
        if "extract_pages" in sig.parameters:
            return "markitdown"
    except Exception as exc:  # pragma: no cover — guard against unexpected errors
        logger.warning("PDF strategy probe failed: %s", exc)
    return "pdfminer_fallback"


class _MinimalLoggingMiddleware(BaseHTTPMiddleware):
    """Minimal request/response logging middleware.

    Logs each request with method, path, status code, and elapsed time to
    stdout as a structured JSON line.  Task 4.4 will replace or extend this
    with a full structured JSON logging implementation.
    """

    async def dispatch(self, request: Request, call_next) -> Response:  # noqa: ANN001
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        log_record = {
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "elapsed_ms": round(elapsed_ms, 2),
        }
        logger.info(json.dumps(log_record))
        return response


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    The function is called once at module load time (via ``app = create_app()``
    at the bottom of this module).  Calling it while
    ``MARKITDOWN_SERVICE_TOKEN`` is not set raises ``ValidationError`` from
    Pydantic — this is the intended fail-fast behaviour (Req 3.3).

    Returns:
        A fully configured FastAPI application instance.
    """
    # Step 1: Load config — raises ValidationError if token is missing/empty.
    settings = Settings()

    # Step 2: Apply XXE hardening before any XML document may be parsed.
    apply_xxe_hardening()

    # Step 3: Probe PDF capability and cache result at module level.
    global PDF_EXTRACTION_STRATEGY  # noqa: PLW0603
    PDF_EXTRACTION_STRATEGY = _probe_pdf_strategy()
    logger.info("PDF extraction strategy: %s", PDF_EXTRACTION_STRATEGY)

    # Step 4: Create FastAPI app and wire routers.
    application = FastAPI(
        title="Markitdown Extractor",
        description="Attachment text extraction microservice for GROWI.",
        version="1.0.0",
    )

    application.include_router(health.router)
    application.include_router(extract.router)

    # Step 5: Add BearerAuthMiddleware (outermost so auth runs before routing).
    # Middleware added with add_middleware is applied in LIFO order, so add the
    # logging middleware first so that it wraps the auth check as well.
    application.add_middleware(_MinimalLoggingMiddleware)
    application.add_middleware(BearerAuthMiddleware, token=settings.MARKITDOWN_SERVICE_TOKEN)

    return application


# Module-level app instance.  The import ``from app.main import app`` in the
# conftest.py client fixture is deferred until after inject_service_token has
# set MARKITDOWN_SERVICE_TOKEN, so Settings() will always find the token.
app = create_app()
