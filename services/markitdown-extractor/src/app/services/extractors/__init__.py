"""Extractor registry: maps MIME types to extractor callables.

Each entry maps a MIME type string to a callable with signature:
    (data: bytes, filename: str) -> list[PageInfo]

PDF, PPTX, and XLSX currently delegate to simple_extractor as a temporary
fallback.  Tasks 3.1, 3.2, and 3.3 will replace those entries with
dedicated extractors without requiring changes to ExtractionService.
"""

from __future__ import annotations

from app.services.extractors.simple_extractor import extract_simple

# MIME type → extractor callable whitelist.
# Only MIME types present here will be accepted by ExtractionService.
EXTRACTOR_REGISTRY: dict[str, object] = {
    # Plain text variants
    "text/plain": extract_simple,
    # JSON
    "application/json": extract_simple,
    # HTML
    "text/html": extract_simple,
    # CSV / TSV
    "text/csv": extract_simple,
    "text/tab-separated-values": extract_simple,
    # XML
    "text/xml": extract_simple,
    "application/xml": extract_simple,
    # YAML
    "text/yaml": extract_simple,
    "application/yaml": extract_simple,
    # Word (.docx)
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": extract_simple,
    # RTF
    "application/rtf": extract_simple,
    "text/rtf": extract_simple,
    # EPUB
    "application/epub+zip": extract_simple,
    # Jupyter Notebook
    "application/vnd.jupyter": extract_simple,
    "application/x-ipynb+json": extract_simple,
    # Outlook MSG
    "application/vnd.ms-outlook": extract_simple,
    # PDF — temporary: task 3.1 will replace extract_simple with pdf_extractor
    "application/pdf": extract_simple,
    # PowerPoint (.pptx) — temporary: task 3.2 will replace with pptx_extractor
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": extract_simple,
    # Excel (.xlsx) — temporary: task 3.3 will replace with xlsx_extractor
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": extract_simple,
}

# File extension → MIME type mapping used as fallback when no MIME hint is given.
EXTENSION_TO_MIME: dict[str, str] = {
    ".txt": "text/plain",
    ".log": "text/plain",
    ".md": "text/plain",
    ".json": "application/json",
    ".html": "text/html",
    ".htm": "text/html",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".xml": "text/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".rtf": "application/rtf",
    ".epub": "application/epub+zip",
    ".ipynb": "application/x-ipynb+json",
    ".msg": "application/vnd.ms-outlook",
    ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
