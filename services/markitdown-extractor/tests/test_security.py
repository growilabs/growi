"""Unit tests for the XXE hardening bootstrap module (Task 2.3).

These tests verify that ``app.security.apply_xxe_hardening()`` correctly:
1. Replaces the stdlib XML parsers with defusedxml variants.
2. Blocks XXE attacks (external entity injection).
3. Emits an INFO log message on success.
4. Creates a safe lxml XMLParser (when lxml is installed).
"""

from __future__ import annotations

import importlib
import logging
import xml.etree.ElementTree as _original_ET
from unittest.mock import patch


class TestApplyXxeHardeningImport:
    """Verify that the security module and function can be imported."""

    def test_security_module_importable(self) -> None:
        """app.security must be importable without error."""
        import app.security  # noqa: F401 — import side-effect test

    def test_apply_xxe_hardening_callable(self) -> None:
        """apply_xxe_hardening must be a callable exported from app.security."""
        from app.security import apply_xxe_hardening

        assert callable(apply_xxe_hardening)


class TestDefuseStdlib:
    """Verify that defuse_stdlib() monkey-patch is applied correctly."""

    def test_etree_parse_replaced_with_defusedxml(self) -> None:
        """After apply_xxe_hardening(), xml.etree.ElementTree.parse must come from defusedxml."""
        from app.security import apply_xxe_hardening

        apply_xxe_hardening()

        import xml.etree.ElementTree as ET

        # defuse_stdlib() replaces ET.parse with defusedxml.common.parse
        assert "defusedxml" in ET.parse.__module__, (
            f"Expected xml.etree.ElementTree.parse to be from defusedxml, "
            f"but got module: {ET.parse.__module__}"
        )

    def test_etree_fromstring_replaced_with_defusedxml(self) -> None:
        """After apply_xxe_hardening(), xml.etree.ElementTree.fromstring must come from defusedxml."""
        from app.security import apply_xxe_hardening

        apply_xxe_hardening()

        import xml.etree.ElementTree as ET

        assert "defusedxml" in ET.fromstring.__module__, (
            f"Expected xml.etree.ElementTree.fromstring to be from defusedxml, "
            f"but got module: {ET.fromstring.__module__}"
        )

    def test_xxe_attack_is_blocked(self) -> None:
        """After apply_xxe_hardening(), parsing XML with an external entity must raise an exception."""
        from app.security import apply_xxe_hardening

        apply_xxe_hardening()

        import xml.etree.ElementTree as ET

        xxe_payload = (
            '<?xml version="1.0"?>'
            "<!DOCTYPE foo ["
            '  <!ENTITY xxe SYSTEM "file:///etc/passwd">'
            "]>"
            "<root>&xxe;</root>"
        )

        raised = False
        try:
            ET.fromstring(xxe_payload)
        except Exception:
            raised = True

        assert raised, "XXE attack was NOT blocked — defusedxml replacement may not have been applied"

    def test_billion_laughs_is_blocked(self) -> None:
        """After apply_xxe_hardening(), a billion-laughs XML payload must be rejected."""
        from app.security import apply_xxe_hardening

        apply_xxe_hardening()

        import xml.etree.ElementTree as ET

        billion_laughs = (
            '<?xml version="1.0"?>'
            "<!DOCTYPE lolz ["
            "  <!ENTITY lol 'lol'>"
            "  <!ENTITY lol2 '&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;'>"
            "  <!ENTITY lol3 '&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;'>"
            "]>"
            "<root>&lol3;</root>"
        )

        raised = False
        try:
            ET.fromstring(billion_laughs)
        except Exception:
            raised = True

        assert raised, "Billion-laughs attack was NOT blocked — defusedxml replacement may not have been applied"


class TestLogging:
    """Verify that apply_xxe_hardening() emits the expected INFO log message."""

    def test_logs_info_message_on_success(self, caplog: "pytest.LogCaptureFixture") -> None:
        """apply_xxe_hardening() must log an INFO message confirming hardening was applied."""
        from app.security import apply_xxe_hardening

        with caplog.at_level(logging.INFO, logger="app.security"):
            apply_xxe_hardening()

        assert any(
            "XXE hardening applied" in record.message
            for record in caplog.records
            if record.levelno == logging.INFO
        ), f"Expected INFO log with 'XXE hardening applied' but got: {[r.message for r in caplog.records]}"


class TestLxmlSafeParser:
    """Verify lxml safe parser creation (only runs when lxml is installed)."""

    def test_lxml_xmlparser_accepts_safe_kwargs(self) -> None:
        """When lxml is available, XMLParser must accept resolve_entities=False, no_network=True.

        This tests the API contract: if lxml changes its API in a way that breaks
        the safe-defaults assertion in apply_xxe_hardening(), this test will catch it.
        """
        try:
            from lxml import etree
        except ImportError:
            import pytest

            pytest.skip("lxml not installed — skipping lxml-specific test")

        # Verify lxml XMLParser accepts the safe-defaults kwargs without raising
        parser = etree.XMLParser(resolve_entities=False, no_network=True)
        assert parser is not None, "lxml XMLParser with safe kwargs must not be None"

    def test_apply_xxe_hardening_does_not_raise_when_lxml_present(self) -> None:
        """apply_xxe_hardening() must not raise even when lxml is installed."""
        try:
            import lxml  # noqa: F401
        except ImportError:
            import pytest

            pytest.skip("lxml not installed — skipping lxml-specific test")

        from app.security import apply_xxe_hardening

        # Must not raise
        apply_xxe_hardening()
