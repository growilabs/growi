"""Unit tests for ExtractionService and EXTRACTOR_REGISTRY.

Tests cover:
- Supported MIME types dispatch to the correct extractor (returns list[PageInfo])
- TXT file → dispatches correctly, returns PageInfo list
- JSON file → dispatches correctly
- MIME hint overrides extension-based lookup
- application/x-custom → UnsupportedFormat raised
- Unknown extension (no MIME hint) → UnsupportedFormat raised
- PDF, PPTX, XLSX are in registry (temporarily use simple_extractor)

Requirements: 1.1 (extraction returns pages array), 1.6 (unsupported formats raise)
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from app.schemas import PageInfo
from app.services.extractors import EXTRACTOR_REGISTRY, EXTENSION_TO_MIME
from app.services.extraction_service import UnsupportedFormat, extract

# Use anyio as the async test runner (pytest-asyncio not installed; anyio plugin is)
pytestmark = pytest.mark.anyio

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _fake_extractor(data: bytes, filename: str) -> list[PageInfo]:
    """A fake extractor that returns a single PageInfo for test assertions."""
    return [PageInfo(pageNumber=None, label=None, content="fake content")]


# ---------------------------------------------------------------------------
# Registry shape tests
# ---------------------------------------------------------------------------


class TestExtractorRegistry:
    def test_registry_is_dict(self) -> None:
        assert isinstance(EXTRACTOR_REGISTRY, dict)

    def test_txt_in_registry(self) -> None:
        assert "text/plain" in EXTRACTOR_REGISTRY

    def test_json_in_registry(self) -> None:
        assert "application/json" in EXTRACTOR_REGISTRY

    def test_html_in_registry(self) -> None:
        assert "text/html" in EXTRACTOR_REGISTRY

    def test_csv_in_registry(self) -> None:
        assert "text/csv" in EXTRACTOR_REGISTRY

    def test_tsv_in_registry(self) -> None:
        assert "text/tab-separated-values" in EXTRACTOR_REGISTRY

    def test_xml_in_registry(self) -> None:
        assert "text/xml" in EXTRACTOR_REGISTRY
        assert "application/xml" in EXTRACTOR_REGISTRY

    def test_yaml_in_registry(self) -> None:
        assert "text/yaml" in EXTRACTOR_REGISTRY
        assert "application/yaml" in EXTRACTOR_REGISTRY

    def test_docx_in_registry(self) -> None:
        assert "application/vnd.openxmlformats-officedocument.wordprocessingml.document" in EXTRACTOR_REGISTRY

    def test_rtf_in_registry(self) -> None:
        assert "application/rtf" in EXTRACTOR_REGISTRY
        assert "text/rtf" in EXTRACTOR_REGISTRY

    def test_epub_in_registry(self) -> None:
        assert "application/epub+zip" in EXTRACTOR_REGISTRY

    def test_ipynb_in_registry(self) -> None:
        assert "application/vnd.jupyter" in EXTRACTOR_REGISTRY
        assert "application/x-ipynb+json" in EXTRACTOR_REGISTRY

    def test_msg_in_registry(self) -> None:
        assert "application/vnd.ms-outlook" in EXTRACTOR_REGISTRY

    def test_pdf_in_registry(self) -> None:
        """PDF must be in registry; task 3.1 will replace the temporary delegate."""
        assert "application/pdf" in EXTRACTOR_REGISTRY

    def test_pptx_in_registry(self) -> None:
        """PPTX must be in registry; task 3.2 will replace the temporary delegate."""
        assert "application/vnd.openxmlformats-officedocument.presentationml.presentation" in EXTRACTOR_REGISTRY

    def test_xlsx_in_registry(self) -> None:
        """XLSX must be in registry; task 3.3 will replace the temporary delegate."""
        assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in EXTRACTOR_REGISTRY

    def test_all_registry_values_are_callable(self) -> None:
        for mime, extractor in EXTRACTOR_REGISTRY.items():
            assert callable(extractor), f"Extractor for {mime!r} is not callable"


class TestExtensionToMime:
    def test_txt_extension(self) -> None:
        assert EXTENSION_TO_MIME.get(".txt") == "text/plain"

    def test_json_extension(self) -> None:
        assert EXTENSION_TO_MIME.get(".json") == "application/json"

    def test_pdf_extension(self) -> None:
        assert EXTENSION_TO_MIME.get(".pdf") == "application/pdf"

    def test_pptx_extension(self) -> None:
        assert EXTENSION_TO_MIME.get(".pptx") == "application/vnd.openxmlformats-officedocument.presentationml.presentation"

    def test_xlsx_extension(self) -> None:
        assert EXTENSION_TO_MIME.get(".xlsx") == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    def test_html_extensions(self) -> None:
        assert EXTENSION_TO_MIME.get(".html") == "text/html"
        assert EXTENSION_TO_MIME.get(".htm") == "text/html"

    def test_docx_extension(self) -> None:
        assert EXTENSION_TO_MIME.get(".docx") == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


# ---------------------------------------------------------------------------
# ExtractionService dispatch tests
# ---------------------------------------------------------------------------


class TestExtractDispatch:
    async def test_txt_dispatches_via_extension(self) -> None:
        """TXT file dispatched by extension lookup → returns list[PageInfo]."""
        data = b"hello world"
        with patch.dict(EXTRACTOR_REGISTRY, {"text/plain": _fake_extractor}):
            pages = await extract(data, "file.txt")
        assert len(pages) == 1
        assert isinstance(pages[0], PageInfo)
        assert pages[0].content == "fake content"

    async def test_json_dispatches_via_extension(self) -> None:
        """JSON file dispatched by extension lookup → returns list[PageInfo]."""
        data = b'{"key": "value"}'
        with patch.dict(EXTRACTOR_REGISTRY, {"application/json": _fake_extractor}):
            pages = await extract(data, "data.json")
        assert len(pages) == 1
        assert isinstance(pages[0], PageInfo)

    async def test_mime_hint_overrides_extension(self) -> None:
        """mime_hint takes priority over extension; e.g. 'data.bin' + hint 'text/plain'."""
        data = b"hello"
        with patch.dict(EXTRACTOR_REGISTRY, {"text/plain": _fake_extractor}):
            pages = await extract(data, "data.bin", mime_hint="text/plain")
        assert len(pages) == 1
        assert pages[0].content == "fake content"

    async def test_mime_hint_not_in_registry_raises(self) -> None:
        """mime_hint present but not in registry → UnsupportedFormat."""
        with pytest.raises(UnsupportedFormat):
            await extract(b"data", "file.txt", mime_hint="application/x-custom")

    async def test_unsupported_mime_raises(self) -> None:
        """Custom MIME type not in registry → UnsupportedFormat raised (Req 1.6)."""
        with pytest.raises(UnsupportedFormat):
            await extract(b"data", "file.xyz")

    async def test_unknown_extension_raises(self) -> None:
        """Unknown extension with no MIME hint → UnsupportedFormat raised."""
        with pytest.raises(UnsupportedFormat):
            await extract(b"data", "archive.unknownext")

    async def test_no_extension_raises(self) -> None:
        """Filename without extension and no MIME hint → UnsupportedFormat raised."""
        with pytest.raises(UnsupportedFormat):
            await extract(b"data", "noextension")

    async def test_pdf_dispatches(self) -> None:
        """PDF dispatches to a callable extractor (task 3.1 will replace with real one)."""
        data = b"%PDF-1.4 stub"
        with patch.dict(EXTRACTOR_REGISTRY, {"application/pdf": _fake_extractor}):
            pages = await extract(data, "document.pdf")
        assert len(pages) >= 1

    async def test_pptx_dispatches(self) -> None:
        """PPTX dispatches to a callable extractor (task 3.2 will replace with real one)."""
        data = b"PK stub pptx"
        with patch.dict(EXTRACTOR_REGISTRY, {"application/vnd.openxmlformats-officedocument.presentationml.presentation": _fake_extractor}):
            pages = await extract(data, "slides.pptx")
        assert len(pages) >= 1

    async def test_xlsx_dispatches(self) -> None:
        """XLSX dispatches to a callable extractor (task 3.3 will replace with real one)."""
        data = b"PK stub xlsx"
        with patch.dict(EXTRACTOR_REGISTRY, {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": _fake_extractor}):
            pages = await extract(data, "spreadsheet.xlsx")
        assert len(pages) >= 1

    async def test_returns_list_of_page_info(self) -> None:
        """Extracted result is always a list[PageInfo]."""
        data = (FIXTURES_DIR / "sample.txt").read_bytes()
        pages = await extract(data, "sample.txt")
        assert isinstance(pages, list)
        assert all(isinstance(p, PageInfo) for p in pages)

    async def test_mime_hint_takes_priority_over_contradicting_extension(self) -> None:
        """mime_hint='application/json' wins over .txt extension."""
        data = b'{"key": "value"}'
        with patch.dict(EXTRACTOR_REGISTRY, {"application/json": _fake_extractor}):
            pages = await extract(data, "file.txt", mime_hint="application/json")
        assert pages[0].content == "fake content"
