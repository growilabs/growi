"""Simple extractor for single-element document formats.

Handles: DOCX, HTML, CSV, TSV, JSON, XML, YAML, TXT, LOG, MD, RTF, EPub,
Jupyter Notebook (.ipynb), Outlook MSG.

Each supported format is converted via markitdown and returned as a single
PageInfo element with pageNumber=None and label=None (no page concept).

Requirement 1.5: returns a single-element pages array with null pageNumber/label.
Requirement 1.7: no external binaries or network egress required.
"""

from __future__ import annotations

import os
from io import BytesIO

from markitdown import MarkItDown

from app.schemas import PageInfo

# Supported file extensions for this extractor.
# The registry (task 3.5) will use these to route MIME types here.
SUPPORTED_EXTENSIONS: frozenset[str] = frozenset(
    {
        ".docx",
        ".html",
        ".htm",
        ".csv",
        ".tsv",
        ".json",
        ".xml",
        ".yaml",
        ".yml",
        ".txt",
        ".log",
        ".md",
        ".rtf",
        ".epub",
        ".ipynb",
        ".msg",
    }
)


def extract_simple(data: bytes, filename: str) -> list[PageInfo]:
    """Extract text from simple single-page formats via markitdown.

    markitdown is initialised with ``enable_plugins=False`` and
    ``llm_client=None`` to satisfy Requirement 1.7 (no external I/O).

    Args:
        data: Raw bytes of the document.
        filename: Original filename, used only to derive the file extension
            so that markitdown picks the correct converter.

    Returns:
        A list containing exactly one PageInfo with pageNumber=None and
        label=None; content holds the Markdown text produced by markitdown.
    """
    md_converter = MarkItDown(enable_plugins=False, llm_client=None)
    ext = _get_extension(filename)
    result = md_converter.convert_stream(BytesIO(data), file_extension=ext)
    content = result.text_content or ""
    return [PageInfo(pageNumber=None, label=None, content=content)]


def _get_extension(filename: str) -> str:
    """Return the lower-cased file extension including the leading dot.

    Examples:
        "report.DOCX" -> ".docx"
        "archive.tar.gz" -> ".gz"
        "noext" -> ""
    """
    _, ext = os.path.splitext(filename)
    return ext.lower()
