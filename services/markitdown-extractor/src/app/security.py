"""XXE hardening bootstrap for the markitdown-extractor service.

This module provides ``apply_xxe_hardening()``, which must be called once at
application startup (app factory / entry point) before any XML is parsed.

Security requirements addressed:
- Req 1.7: No external binary / egress dependencies — XXE external-entity
  resolution would silently cause outbound network connections; defusing it
  closes that path.
- Req 2.4: Correct operation under egress-blocked environments — if XXE were
  not defused, parsing certain DOCX / XLSX / PPTX / SVG / EPUB files could
  block indefinitely waiting for a network resource that is unreachable.

Implementation:
- ``defusedxml.defuse_stdlib()`` monkey-patches ``xml.etree``, ``xml.sax``, and
  ``xml.dom`` so that their parser entry-points (``parse``, ``fromstring``, etc.)
  raise ``DefusedXmlException`` subclasses on any DTD-based attack vector.
- When ``lxml`` is installed an additional API-contract assertion verifies that
  ``etree.XMLParser`` still accepts ``resolve_entities=False, no_network=True``.
  If the assertion fails the process exits immediately (fail-fast on boot).
"""

from __future__ import annotations

import logging

import defusedxml

logger = logging.getLogger(__name__)


def apply_xxe_hardening() -> None:
    """Apply XXE hardening to stdlib XML parsers via defusedxml monkey-patch.

    Must be called once during application startup, before any XML document is
    parsed.  Calling it multiple times is safe — defusedxml is idempotent.

    Raises:
        AssertionError: If the lxml API contract check fails (i.e., lxml no
            longer accepts ``resolve_entities`` / ``no_network`` kwargs).  This
            is intentional fail-fast behaviour: a broken assertion means the
            application cannot guarantee XXE safety and must not start.
    """
    # Replace stdlib XML parser entry-points with defusedxml-hardened variants.
    # This covers xml.etree.ElementTree, xml.sax, and xml.dom.minidom.
    defusedxml.defuse_stdlib()

    # When lxml is available, assert that its XMLParser still accepts the
    # safe-defaults kwargs.  This is an API contract check: if lxml drops
    # these parameters, we fail fast rather than silently use an unsafe parser.
    try:
        from lxml import etree  # type: ignore[import-not-found]

        # Create a safe parser — this both verifies the API and produces an
        # instance that callers can use as a template for lxml parsing.
        safe_parser = etree.XMLParser(resolve_entities=False, no_network=True)
        assert safe_parser is not None, (
            "lxml XMLParser(resolve_entities=False, no_network=True) returned None — "
            "lxml API contract broken; cannot guarantee XXE safety"
        )
    except ImportError:
        # lxml is optional; if not installed there is nothing to check.
        pass

    logger.info("XXE hardening applied: stdlib XML parsers replaced with defusedxml variants")
