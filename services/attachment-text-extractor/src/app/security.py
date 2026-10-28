"""XXE hardening bootstrap for the attachment-text-extractor service.

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
"""

from __future__ import annotations

import logging

import defusedxml

logger = logging.getLogger(__name__)


def apply_xxe_hardening() -> None:
    """Apply XXE hardening to stdlib XML parsers via defusedxml monkey-patch.

    Must be called once during application startup, before any XML document is
    parsed.  Calling it multiple times is safe — defusedxml is idempotent.
    """
    # Replace stdlib XML parser entry-points with defusedxml-hardened variants.
    # This covers xml.etree.ElementTree, xml.sax, and xml.dom.minidom.
    defusedxml.defuse_stdlib()

    logger.info("XXE hardening applied: stdlib XML parsers replaced with defusedxml variants")
