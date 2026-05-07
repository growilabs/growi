"""ExtractionService: orchestrates MIME detection and extractor dispatch.

MIME resolution order:
  1. ``mime_hint`` (from Content-Type header) — used if present and in registry
  2. File extension fallback via EXTENSION_TO_MIME
  3. ``UnsupportedFormat`` raised if no match found in the whitelist registry

Requirement 1.1: returns list[PageInfo] for supported formats.
Requirement 1.6: raises UnsupportedFormat for unsupported MIME types.
"""

from __future__ import annotations

import os

from app.schemas import PageInfo
from app.services.extractors import EXTRACTOR_REGISTRY, EXTENSION_TO_MIME


class UnsupportedFormat(Exception):
    """Raised when the resolved MIME type is not in the extractor registry.

    Corresponds to ErrorCode.unsupported_format (Requirement 1.6).
    """


async def extract(
    data: bytes,
    filename: str,
    mime_hint: str | None = None,
) -> list[PageInfo]:
    """Dispatch extraction to the appropriate extractor.

    MIME resolution uses ``mime_hint`` first (e.g., the Content-Type header
    value), then falls back to the file extension.  If the resolved MIME type
    is not in the whitelist registry, ``UnsupportedFormat`` is raised.

    Args:
        data: Raw bytes of the uploaded file.
        filename: Original filename; used for extension-based MIME fallback and
            passed through to the extractor so it can pick the right converter.
        mime_hint: Optional MIME type hint (e.g., from the HTTP Content-Type
            header).  When provided this takes priority over the extension.

    Returns:
        A list of PageInfo objects representing the extracted pages/sections.

    Raises:
        UnsupportedFormat: The resolved MIME type is not in EXTRACTOR_REGISTRY.
    """
    mime = _resolve_mime(filename, mime_hint)
    extractor = EXTRACTOR_REGISTRY.get(mime)
    if extractor is None:
        raise UnsupportedFormat(
            f"MIME type {mime!r} is not supported. "
            "Supported types: " + ", ".join(sorted(EXTRACTOR_REGISTRY))
        )
    return extractor(data, filename)


def _resolve_mime(filename: str, mime_hint: str | None) -> str:
    """Resolve the effective MIME type for the given file.

    Tries mime_hint first; if absent or empty, derives the MIME type from
    the file extension using EXTENSION_TO_MIME.  Returns the resolved string
    (may not be in the registry — the caller handles that check).
    """
    if mime_hint:
        return mime_hint

    _, ext = os.path.splitext(filename)
    ext_lower = ext.lower()
    return EXTENSION_TO_MIME.get(ext_lower, f"application/octet-stream+{ext_lower}")
