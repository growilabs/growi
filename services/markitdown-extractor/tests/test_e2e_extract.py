"""End-to-end extraction tests for POST /extract (Task 6.2).

Tests the full extraction pipeline using the real FastAPI app and real fixture
files.  Only TXT format is required to be green in this session; other formats
(PDF/PPTX/XLSX/DOCX/JSON) are deferred.

Requirements: 1.1, 1.5, 1.6
Boundary: ExtractRouter, ExtractionService
"""

from __future__ import annotations

import os

# Resolve path to fixtures relative to this file.
_FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


class TestExtractTxt:
    """E2E tests for TXT file extraction via POST /extract."""

    def test_txt_returns_extract_response(self, client, test_token):
        """TXT fixture must produce a valid ExtractResponse.

        Verifies:
        - HTTP 200
        - Single page in pages array (Req 1.5: single-element array for TXT)
        - pageNumber is None (TXT has no page concept)
        - label is None (TXT has no label concept)
        - content is a non-empty string
        - mimeType reflects text/plain
        - extractedCharacters >= 0
        """
        fixture_path = os.path.join(_FIXTURES_DIR, "sample.txt")
        with open(fixture_path, "rb") as fh:
            txt_content = fh.read()

        resp = client.post(
            "/extract",
            headers={"Authorization": f"Bearer {test_token}"},
            files={"file": ("sample.txt", txt_content, "text/plain")},
        )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        body = resp.json()

        # Validate top-level keys (Req 1.1: ExtractResponse shape).
        assert "pages" in body, "Response must contain 'pages'"
        assert "mimeType" in body, "Response must contain 'mimeType'"
        assert "extractedCharacters" in body, "Response must contain 'extractedCharacters'"

        # Req 1.5: single-element pages array for TXT.
        assert len(body["pages"]) == 1, f"TXT should produce 1 page, got {len(body['pages'])}"

        page = body["pages"][0]

        # Req 1.5: pageNumber and label are null for plain text.
        assert page["pageNumber"] is None, f"pageNumber should be None for TXT, got {page['pageNumber']}"
        assert page["label"] is None, f"label should be None for TXT, got {page['label']}"

        # Content must be a string (may be empty if markitdown produces nothing).
        assert isinstance(page["content"], str), "content must be a string"

        # MIME type must reflect text/plain (provided via Content-Type in file upload).
        assert body["mimeType"] == "text/plain", f"mimeType should be 'text/plain', got {body['mimeType']}"

        # Character count is consistent with content.
        assert body["extractedCharacters"] >= 0
        assert body["extractedCharacters"] == len(page["content"])


class TestUnsupportedFormat:
    """E2E tests verifying 400 unsupported_format for unknown MIME types."""

    def test_unsupported_mime_returns_400(self, client, test_token):
        """Upload with unsupported MIME type must return 400 with unsupported_format code.

        Req 1.6: ExtractionService raises UnsupportedFormat for MIME types not
        in the whitelist registry, and the router maps this to 400.
        """
        resp = client.post(
            "/extract",
            headers={"Authorization": f"Bearer {test_token}"},
            files={"file": ("data.bin", b"some bytes", "application/x-custom")},
        )

        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"

        body = resp.json()
        assert body["code"] == "unsupported_format", f"Expected 'unsupported_format', got {body['code']}"
        assert "message" in body, "ErrorResponse must include 'message'"
