"""Shared pytest fixtures for the markitdown-extractor test suite.

This module provides:
- ``test_token``: the bearer token injected via environment for every test
- ``client``: a Starlette/FastAPI ``TestClient`` wrapping the FastAPI app

The ``client`` fixture is a **lazy** import: the FastAPI app (``app.main``) may
not exist yet during early infrastructure tasks.  Tests that use ``client``
will be skipped automatically when ``main.py`` is absent; all other tests run
unaffected.
"""

from __future__ import annotations

import pytest

# ---------------------------------------------------------------------------
# Token fixture — must be set before any Settings object is instantiated
# ---------------------------------------------------------------------------
TEST_TOKEN = "test-service-token-for-pytest"  # noqa: S105 — hardcoded test credential only


@pytest.fixture(autouse=True)
def inject_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inject MARKITDOWN_SERVICE_TOKEN into the environment for every test.

    Using ``autouse=True`` ensures that all tests run with a valid token so
    that ``Settings()`` never raises ``ValidationError`` due to a missing token.
    Individual tests that need to exercise the missing-token path must call
    ``monkeypatch.delenv("MARKITDOWN_SERVICE_TOKEN", raising=False)`` **after**
    this fixture has run (pytest fixture ordering guarantees this).
    """
    monkeypatch.setenv("MARKITDOWN_SERVICE_TOKEN", TEST_TOKEN)


@pytest.fixture()
def test_token() -> str:
    """Return the bearer token that was injected into the environment.

    Use this fixture in tests that need the token value (e.g., to build
    ``Authorization: Bearer <token>`` headers).
    """
    return TEST_TOKEN


# ---------------------------------------------------------------------------
# TestClient fixture — lazy: skips if app.main does not exist yet
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(test_token: str):  # noqa: ANN201 — return type depends on import availability
    """Return an httpx-based ``TestClient`` wrapping the FastAPI application.

    The import of ``app.main`` is deferred so that this fixture does not cause
    collection failures when ``main.py`` has not been created yet (tasks 1.4
    and earlier).  Tests that request this fixture will be **skipped** until
    ``app.main`` is available.

    Once ``app.main`` exists the fixture yields an ``httpx.Client``-compatible
    ``TestClient`` whose base URL is ``http://test``.  The service token is
    already set in the environment by the ``inject_service_token`` autouse
    fixture, so the FastAPI ``Settings`` object instantiated inside the app
    will see the correct value.
    """
    try:
        from app.main import app  # deferred import
    except ModuleNotFoundError:
        pytest.skip("app.main not yet implemented — skipping client-dependent test")

    from starlette.testclient import TestClient

    with TestClient(app, raise_server_exceptions=True) as tc:
        yield tc
