"""Shared pytest fixtures for the attachment-text-extractor test suite.

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
    """Inject ATTACHMENT_EXTRACTOR_SERVICE_TOKEN into the environment for every test.

    Using ``autouse=True`` ensures that all tests run with a valid token so
    that ``Settings()`` never raises ``ValidationError`` due to a missing token.
    Individual tests that need to exercise the missing-token path must call
    ``monkeypatch.delenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", raising=False)`` **after**
    this fixture has run (pytest fixture ordering guarantees this).
    """
    monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", TEST_TOKEN)


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


# ---------------------------------------------------------------------------
# Document fixtures (generated in-test; see tests/fixture_files.py)
# ---------------------------------------------------------------------------
from fixture_files import (  # noqa: E402, F401 — re-exported so pytest registers them for every test directory
    docx_deeply_nested,
    docx_encrypted,
    docx_large_images_path,
    docx_zip_bomb_path,
    epub,
    legacy_doc,
    legacy_fixture_sha256,
    legacy_ppt,
    odp,
    ods,
    odt,
    office_password,
    pdf_corrupt,
    pdf_image_only,
    pdf_owner_password_only,
    pdf_password,
    pdf_text,
    pdf_user_password,
    pptx_encrypted,
    pptx_large_images_path,
    pptx_multi_slide,
    rtf,
    text_euc_jp,
    text_shift_jis,
    text_utf8_bom,
    xls,
    xlsx_chart_sheet,
    xlsx_encrypted,
    xlsx_hidden_sheet,
    xlsx_large_for_timeout_path,
    xlsx_multi_sheet,
    xlsx_over_cell_limit_path,
    xlsx_single_sheet,
)
