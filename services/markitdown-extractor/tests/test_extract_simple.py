"""Unit tests for simple_extractor.py.

Tests cover:
- TXT and JSON with real fixture files
- Empty content still returns a single PageInfo (not empty list)
- markitdown is called with enable_plugins=False and llm_client=None
- Minimal structurally-valid bytes for remaining 12 format types
  (HTML, CSV, TSV, XML, YAML, DOCX, RTF, EPUB, IPYNB, MSG, Markdown, log)

All assertions:
  len(pages) == 1
  pages[0].pageNumber is None
  pages[0].label is None
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.schemas import PageInfo
from app.services.extractors.simple_extractor import extract_simple

FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _assert_single_page(pages: list[PageInfo]) -> None:
    """Assert exactly one PageInfo with pageNumber=None and label=None."""
    assert len(pages) == 1
    assert pages[0].pageNumber is None
    assert pages[0].label is None


# ---------------------------------------------------------------------------
# Real fixture files
# ---------------------------------------------------------------------------


class TestTxtFixture:
    def test_returns_single_page(self) -> None:
        data = (FIXTURES_DIR / "sample.txt").read_bytes()
        pages = extract_simple(data, "sample.txt")
        _assert_single_page(pages)

    def test_content_is_non_empty(self) -> None:
        data = (FIXTURES_DIR / "sample.txt").read_bytes()
        pages = extract_simple(data, "sample.txt")
        assert pages[0].content != ""

    def test_content_contains_text(self) -> None:
        data = (FIXTURES_DIR / "sample.txt").read_bytes()
        pages = extract_simple(data, "sample.txt")
        assert "GROWI" in pages[0].content or "Hello" in pages[0].content


class TestJsonFixture:
    def test_returns_single_page(self) -> None:
        data = (FIXTURES_DIR / "sample.json").read_bytes()
        pages = extract_simple(data, "sample.json")
        _assert_single_page(pages)

    def test_content_is_non_empty(self) -> None:
        data = (FIXTURES_DIR / "sample.json").read_bytes()
        pages = extract_simple(data, "sample.json")
        assert pages[0].content != ""


# ---------------------------------------------------------------------------
# Empty content edge case
# ---------------------------------------------------------------------------


class TestEmptyContent:
    def test_empty_txt_returns_single_page(self) -> None:
        """Even if markitdown returns empty text, we still return one PageInfo."""
        pages = extract_simple(b"", "empty.txt")
        assert len(pages) == 1
        assert pages[0].pageNumber is None
        assert pages[0].label is None
        # content may be empty string — that is acceptable
        assert isinstance(pages[0].content, str)


# ---------------------------------------------------------------------------
# markitdown initialisation contract
# ---------------------------------------------------------------------------


class TestMarkitdownInit:
    def test_enable_plugins_false(self) -> None:
        """MarkItDown must be initialised with enable_plugins=False."""
        with patch("app.services.extractors.simple_extractor.MarkItDown") as mock_cls:
            mock_instance = MagicMock()
            mock_instance.convert_stream.return_value = MagicMock(text_content="hi")
            mock_cls.return_value = mock_instance

            extract_simple(b"hello", "test.txt")

            mock_cls.assert_called_once()
            _, kwargs = mock_cls.call_args
            assert kwargs.get("enable_plugins") is False

    def test_llm_client_none(self) -> None:
        """MarkItDown must be initialised with llm_client=None."""
        with patch("app.services.extractors.simple_extractor.MarkItDown") as mock_cls:
            mock_instance = MagicMock()
            mock_instance.convert_stream.return_value = MagicMock(text_content="hi")
            mock_cls.return_value = mock_instance

            extract_simple(b"hello", "test.txt")

            mock_cls.assert_called_once()
            _, kwargs = mock_cls.call_args
            assert kwargs.get("llm_client") is None


# ---------------------------------------------------------------------------
# Minimal bytes fixtures — structural-only, not content-coverage tests
# The goal is to prove the extractor routes the extension correctly and
# returns the correct PageInfo structure regardless of content richness.
# ---------------------------------------------------------------------------


class TestHtml:
    def test_returns_single_page(self) -> None:
        html = b"<html><body><p>Hello</p></body></html>"
        pages = extract_simple(html, "page.html")
        _assert_single_page(pages)


class TestCsv:
    def test_returns_single_page(self) -> None:
        csv = b"name,age\nAlice,30\nBob,25\n"
        pages = extract_simple(csv, "data.csv")
        _assert_single_page(pages)


class TestTsv:
    def test_returns_single_page(self) -> None:
        tsv = b"name\tage\nAlice\t30\nBob\t25\n"
        pages = extract_simple(tsv, "data.tsv")
        _assert_single_page(pages)


class TestXml:
    def test_returns_single_page(self) -> None:
        xml = b"<?xml version='1.0'?><root><item>value</item></root>"
        pages = extract_simple(xml, "data.xml")
        _assert_single_page(pages)


class TestYaml:
    def test_returns_single_page(self) -> None:
        yaml = b"title: test\nversion: 1\n"
        pages = extract_simple(yaml, "config.yaml")
        _assert_single_page(pages)


class TestMarkdown:
    def test_returns_single_page(self) -> None:
        md = b"# Heading\n\nSome content.\n"
        pages = extract_simple(md, "notes.md")
        _assert_single_page(pages)


class TestLog:
    def test_returns_single_page(self) -> None:
        log = b"2025-01-01 INFO Starting service\n2025-01-01 ERROR Something failed\n"
        pages = extract_simple(log, "app.log")
        _assert_single_page(pages)


class TestIpynb:
    def test_returns_single_page(self) -> None:
        notebook = json.dumps(
            {
                "nbformat": 4,
                "nbformat_minor": 5,
                "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}},
                "cells": [
                    {
                        "cell_type": "markdown",
                        "metadata": {},
                        "source": ["# Test Notebook\n"],
                        "id": "cell1",
                    },
                    {
                        "cell_type": "code",
                        "metadata": {},
                        "source": ["print('hello')\n"],
                        "outputs": [],
                        "execution_count": None,
                        "id": "cell2",
                    },
                ],
            }
        ).encode()
        pages = extract_simple(notebook, "notebook.ipynb")
        _assert_single_page(pages)


class TestDocx:
    def test_returns_single_page(self) -> None:
        """DOCX is a ZIP-based format; use a minimal valid ZIP magic to satisfy
        markitdown (it will raise on truly broken bytes, so use a real minimal
        DOCX fixture instead of random bytes)."""
        # Minimal DOCX: Python's zipfile creates a valid ZIP-based container.
        import io
        import zipfile

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            # Minimum required entry for an OOXML-based document
            zf.writestr(
                "[Content_Types].xml",
                '<?xml version="1.0"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/word/document.xml"'
                ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                "</Types>",
            )
            zf.writestr(
                "_rels/.rels",
                '<?xml version="1.0"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
                ' Target="word/document.xml"/>'
                "</Relationships>",
            )
            zf.writestr(
                "word/document.xml",
                '<?xml version="1.0"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body>"
                "</w:document>",
            )
        docx_bytes = buf.getvalue()
        pages = extract_simple(docx_bytes, "document.docx")
        _assert_single_page(pages)


class TestRtf:
    def test_rtf_returns_single_page(self) -> None:
        rtf_bytes = b"{\\rtf1\\ansi Hello, RTF world!}"
        pages = extract_simple(rtf_bytes, "document.rtf")
        assert len(pages) == 1
        assert pages[0].pageNumber is None
        assert pages[0].label is None
        assert isinstance(pages[0].content, str)


def _make_minimal_epub() -> bytes:
    """Create a minimal valid EPUB (ZIP-based) for testing purposes."""
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?>\n'
            '<container version="1.0" xmlns="urn:oasis:schemas:container">\n'
            "  <rootfiles>\n"
            '    <rootfile full-path="OEBPS/content.opf"'
            ' media-type="application/oebps-package+xml"/>\n'
            "  </rootfiles>\n"
            "</container>",
        )
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0"?>\n'
            '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">\n'
            "  <metadata>"
            '<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Test</dc:title>'
            "</metadata>\n"
            "  <manifest>"
            '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
            "</manifest>\n"
            '  <spine toc="ncx"></spine>\n'
            "</package>",
        )
        z.writestr(
            "OEBPS/toc.ncx",
            '<?xml version="1.0"?>\n'
            '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
            '  <head><meta name="dtb:uid" content="uid"/></head>\n'
            "  <docTitle><text>Test</text></docTitle>\n"
            "  <navMap></navMap>\n"
            "</ncx>",
        )
    return buf.getvalue()


class TestEpub:
    def test_epub_returns_single_page(self) -> None:
        epub_bytes = _make_minimal_epub()
        pages = extract_simple(epub_bytes, "book.epub")
        assert len(pages) == 1
        assert pages[0].pageNumber is None
        assert pages[0].label is None
        assert isinstance(pages[0].content, str)


class TestMsg:
    def test_msg_returns_single_page(self) -> None:
        """MSG (Outlook Message) format: mock markitdown since constructing
        a valid binary MSG file is complex and out of scope for unit tests."""
        from markitdown import DocumentConverterResult

        mock_result = MagicMock(spec=DocumentConverterResult)
        mock_result.text_content = "From: test@example.com\nSubject: Test"
        with patch("app.services.extractors.simple_extractor.MarkItDown") as mock_md:
            mock_instance = MagicMock()
            mock_instance.convert_stream.return_value = mock_result
            mock_md.return_value = mock_instance

            pages = extract_simple(b"fake_msg_bytes", "email.msg")
            assert len(pages) == 1
            assert pages[0].pageNumber is None
            assert pages[0].label is None
            assert pages[0].content == "From: test@example.com\nSubject: Test"
