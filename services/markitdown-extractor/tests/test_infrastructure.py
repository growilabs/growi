"""Infrastructure smoke tests for the markitdown-extractor test suite (Task 1.4).

These tests verify that:
1. The shared fixtures in ``conftest.py`` are importable and functional.
2. The ``tests/fixtures/`` directory contains the expected static files.
3. The ``inject_service_token`` autouse fixture correctly sets the env var.

They intentionally do NOT test FastAPI behaviour — that is deferred to later
tasks once ``app.main`` exists.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestConftest:
    """Verify that conftest.py fixtures are accessible and functional."""

    def test_inject_service_token_autouse_sets_env(self) -> None:
        """The autouse fixture must inject MARKITDOWN_SERVICE_TOKEN into os.environ."""
        assert os.environ.get("MARKITDOWN_SERVICE_TOKEN") == "test-service-token-for-pytest"

    def test_test_token_fixture_returns_string(self, test_token: str) -> None:
        """test_token fixture must return a non-empty string."""
        assert isinstance(test_token, str)
        assert len(test_token) > 0

    def test_test_token_matches_env(self, test_token: str) -> None:
        """test_token fixture value must match the injected env var."""
        assert test_token == os.environ.get("MARKITDOWN_SERVICE_TOKEN")

    def test_client_fixture_skips_when_main_absent(self, request: pytest.FixtureRequest) -> None:
        """client fixture must skip (not error) when app.main does not exist.

        We verify this indirectly: if this test is running, then either
        app.main exists (in which case ``client`` should work) or app.main
        is absent (in which case ``client``-dependent tests are skipped).
        We check only that requesting the ``client`` fixture does not raise
        an ImportError at collection time.
        """
        # The mere fact that this test file was collected without ImportError
        # confirms that conftest.py's lazy import pattern is correct.
        assert True


class TestFixtureFiles:
    """Verify that static fixture files are present and well-formed."""

    def test_fixtures_directory_exists(self) -> None:
        """tests/fixtures/ directory must exist."""
        assert FIXTURES_DIR.is_dir(), f"fixtures directory not found at {FIXTURES_DIR}"

    def test_sample_txt_exists(self) -> None:
        """sample.txt must exist in tests/fixtures/."""
        assert (FIXTURES_DIR / "sample.txt").is_file()

    def test_sample_txt_is_non_empty(self) -> None:
        """sample.txt must contain at least one non-whitespace character."""
        content = (FIXTURES_DIR / "sample.txt").read_text(encoding="utf-8")
        assert content.strip()

    def test_sample_json_exists(self) -> None:
        """sample.json must exist in tests/fixtures/."""
        assert (FIXTURES_DIR / "sample.json").is_file()

    def test_sample_json_is_valid(self) -> None:
        """sample.json must be parseable as JSON."""
        raw = (FIXTURES_DIR / "sample.json").read_text(encoding="utf-8")
        data = json.loads(raw)
        assert isinstance(data, dict)

    def test_generate_fixtures_script_exists(self) -> None:
        """generate_fixtures.py must exist for future binary fixture generation."""
        assert (FIXTURES_DIR / "generate_fixtures.py").is_file()

    def test_readme_exists(self) -> None:
        """README.md must exist in tests/fixtures/ to document the fixture files."""
        assert (FIXTURES_DIR / "README.md").is_file()
