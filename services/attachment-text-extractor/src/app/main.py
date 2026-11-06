"""FastAPI application factory for the attachment-text-extractor service.

Startup sequence (Req 3.3, 3.4):
1. Load Settings — fail fast if ATTACHMENT_EXTRACTOR_SERVICE_TOKEN is absent or empty.
2. Apply XXE hardening (defusedxml.defuse_stdlib()) before any XML is parsed.
3. Wire health and extract routers.
4. Add BearerAuthMiddleware (token from Settings).
5. Add a minimal structured JSON logging middleware (full format in task 4.4).

The lifespan creates the ConversionRunner and starts its forkserver before the first request is
served. A forkserver that cannot start never aborts the boot: start() reports it as not ready, so
/readyz answers 503 while /healthz stays ok (a restart would not fix a missing dependency, and
every /readyz call retries the probe, which restarts a dead forkserver).
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import sys
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Final

from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import Settings
from app.limits import Limits
from app.middleware.bearer_auth import BearerAuthMiddleware
from app.routers import extract, health
from app.runner import ConversionRunner
from app.security import apply_xxe_hardening

logger = logging.getLogger(__name__)

_TOKEN_ENV: Final = "ATTACHMENT_EXTRACTOR_SERVICE_TOKEN"  # noqa: S105 — the variable name, not a secret
_LOG_HANDLER_NAME: Final = "attachment-text-extractor"
_LOG_FORMAT: Final = "%(asctime)s %(levelname)s %(name)s %(message)s"


def configure_logging(level: str) -> None:
    """Send the ``app.*`` loggers to stderr at `level` (idempotent).

    uvicorn configures only its own loggers, so without this the per-request lines are dropped.
    The root logger and uvicorn's loggers are left alone; records still propagate, so pytest's
    caplog sees them.
    """
    app_logger = logging.getLogger("app")
    app_logger.setLevel(level)
    if not any(handler.get_name() == _LOG_HANDLER_NAME for handler in app_logger.handlers):
        handler = logging.StreamHandler(sys.stderr)
        handler.set_name(_LOG_HANDLER_NAME)
        handler.setFormatter(logging.Formatter(_LOG_FORMAT))
        app_logger.addHandler(handler)


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


def create_app(**runner_options: Any) -> FastAPI:  # noqa: ANN401
    """Create and configure the FastAPI application.

    The function is called once at module load time (via ``app = create_app()``
    at the bottom of this module).  Calling it while
    ``ATTACHMENT_EXTRACTOR_SERVICE_TOKEN`` is not set raises ``ValidationError`` from
    Pydantic — this is the intended fail-fast behaviour (Req 3.3).

    Args:
        runner_options: Extra keyword arguments for ``ConversionRunner.from_settings``
            (tests use them for short probe timeouts).

    Returns:
        A fully configured FastAPI application instance.
    """
    # Step 1: Load config — raises ValidationError if token is missing/empty.
    settings = Settings()

    configure_logging(settings.LOG_LEVEL)

    # Step 2: Apply XXE hardening before any XML document may be parsed.
    apply_xxe_hardening()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.limits = Limits.from_settings(settings)
        runner = ConversionRunner.from_settings(settings, **runner_options)
        application.state.runner = runner
        # The stdlib forkserver inherits the whole environment and every conversion child forks
        # from it; settings already holds the token, so it must not reach those processes.
        os.environ.pop(_TOKEN_ENV, None)
        # Must finish before serving: the preload list only applies to a forkserver not yet started.
        await runner.start()
        try:
            yield
        finally:
            # stop() waits for every child of the forkserver, so it must not block the event loop.
            await asyncio.to_thread(runner.stop)

    # Step 3: Create FastAPI app and wire routers.
    application = FastAPI(
        lifespan=lifespan,
        title="Attachment Text Extractor",
        description="Attachment text extraction microservice for GROWI.",
        version="1.0.0",
    )

    application.include_router(health.router)
    application.include_router(extract.router)
    application.openapi = lambda: _openapi_with_extract_form(application)  # type: ignore[method-assign]

    # Step 4: Add BearerAuthMiddleware (outermost so auth runs before routing).
    # Middleware added with add_middleware is applied in LIFO order, so add the
    # logging middleware first so that it wraps the auth check as well.
    application.add_middleware(_MinimalLoggingMiddleware)
    application.add_middleware(BearerAuthMiddleware, token=settings.ATTACHMENT_EXTRACTOR_SERVICE_TOKEN)

    return application


def _openapi_with_extract_form(application: FastAPI) -> dict[str, Any]:
    """FastAPI's schema plus the POST /extract form body, which the router parses itself."""
    if application.openapi_schema is None:
        schema = FastAPI.openapi(application)
        schemas = schema.setdefault("components", {}).setdefault("schemas", {})
        schemas[extract.FORM_SCHEMA_NAME] = copy.deepcopy(extract.FORM_SCHEMA)
    return application.openapi_schema  # type: ignore[return-value]


# Module-level app instance.  The import ``from app.main import app`` in the
# conftest.py client fixture is deferred until after inject_service_token has
# set ATTACHMENT_EXTRACTOR_SERVICE_TOKEN, so Settings() will always find the token.
app = create_app()
