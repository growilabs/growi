"""End-to-end tests over HTTP: the real app, the real lifespan and the real runner.

Every request goes through BearerAuthMiddleware, the router, the concurrency slot, a real
forkserver child and the real conversion code. Only the cases that cannot be produced from a
document (a crashing or hanging child, a sub-second deadline) swap the runner's child entry or
deadline, through the same options the lifespan accepts.

Blocking the network is covered by the container checks (tasks 8.1 / 8.3), not here.

Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.11, 1.12, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7
"""

from __future__ import annotations

import json
import logging
import multiprocessing
import sys
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from fixture_files import (
    JAPANESE_SAMPLE,
    _build_pdf,
    _pdf_stream,
    make_docx,
)

# The child entry stand-ins live next to the runner tests; the forkserver child imports them by name.
sys.path.insert(0, str(Path(__file__).parent / "runner"))
import child_targets  # noqa: E402

# Must equal conftest.TEST_TOKEN: the module-level app in app.main is built once, with whichever token is set first.
TOKEN = "test-service-token-for-pytest"  # noqa: S105 — test credential
AUTH = {"Authorization": f"Bearer {TOKEN}"}
MIB = 1024 * 1024

CONTENT_MARKER = "SECRET-CONTENT-MARKER-7f3a"
FILE_NAME_MARKER = "SECRET-FILE-NAME-MARKER-91c2"

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


@contextmanager
def _serve(
    env: dict[str, object] | None = None, *, timeout_s: float | None = None, **runner_options: Any
) -> Iterator[TestClient]:  # noqa: ANN401
    """Start the real app (lifespan included) with `env` as settings.

    `timeout_s` overrides the runner deadline with a float: Settings.TIMEOUT_S is an integer, so
    a sub-second deadline cannot come from the environment. The router keeps a lazily created
    process-wide Limits object, so it is reset to make the settings above take effect.
    """
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", TOKEN)
        for key, value in (env or {}).items():
            mp.setenv(key, str(value))
        from app import main
        from app.conversion.limits import ConversionLimits
        from app.routers import extract as extract_router
        from app.runner import ConversionRunner

        mp.setattr(extract_router, "limits", None)
        if timeout_s is not None:

            def from_settings(settings: Any, **options: Any) -> ConversionRunner:  # noqa: ANN401
                return ConversionRunner(
                    limits=ConversionLimits.from_settings(settings),
                    timeout_s=timeout_s,
                    max_input_bytes=settings.MAX_FILE_SIZE_MB * MIB,
                    **options,
                )

            mp.setattr(ConversionRunner, "from_settings", staticmethod(from_settings))
        with TestClient(main.create_app(**runner_options)) as client:
            yield client


def _post(client: TestClient, name: str, data: bytes, mime: str | None = None, *, headers: dict | None = AUTH):  # noqa: ANN202
    form = {"mimeType": mime} if mime is not None else None
    return client.post("/extract", headers=headers, files={"file": (name, data)}, data=form)


def _assert_error(response, status: int, code: str, kind: str) -> None:  # noqa: ANN001
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"code", "message"}
    assert body["code"] == code
    # Failures of the conversion carry "<kind>: <fixed text>"; the router's own rows (413, 503) carry a plain sentence.
    if kind:
        assert body["message"].split(":", 1)[0] == kind


def _assert_no_stray_children() -> None:
    assert multiprocessing.active_children() == []


@pytest.fixture(scope="class")
def default_client() -> Iterator[TestClient]:
    # Class scope, not module scope: every app owns the process-wide forkserver, so two apps must never overlap.
    with _serve() as client:
        yield client


# ---------------------------------------------------------------------------
# Japanese PDF with line breaks (the only builder that needs CJK text without a font)
# ---------------------------------------------------------------------------


def _japanese_lines_pdf(lines: list[str]) -> bytes:
    codes = {ch: i + 1 for i, ch in enumerate(dict.fromkeys("".join(lines)))}
    bfchar = "".join(f"<{code:04X}> <{ord(ch):04X}>\n" for ch, code in codes.items()).encode()
    cmap = (
        b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
        b"/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n"
        b"1 begincodespacerange <0000> <FFFF> endcodespacerange\n"
        + b"%d beginbfchar\n" % len(codes)
        + bfchar
        + b"endbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end"
    )
    extras = [
        b"<< /Type /Font /Subtype /Type0 /BaseFont /TestFont /Encoding /Identity-H"
        b" /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>",
        b"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestFont"
        b" /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>",
        _pdf_stream(b"", cmap),
    ]
    shown = b"".join(
        b"1 0 0 1 72 %d Tm <" % (700 - 100 * i) + "".join(f"{codes[c]:04X}" for c in line).encode() + b"> Tj\n"
        for i, line in enumerate(lines)
    )
    return _build_pdf([(b"<< /Font << /F1 4 0 R >> >>", b"BT /F1 24 Tf\n" + shown + b"ET")], extras)


# ---------------------------------------------------------------------------
# 1. Success matrix (Req 1.1 - 1.6, 1.8, 1.9, 1.12)
# ---------------------------------------------------------------------------

_IPYNB = json.dumps(
    {
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Notebook title"]},
            {
                "cell_type": "code",
                "metadata": {},
                "execution_count": 1,
                "source": ["print('cell source marker')"],
                "outputs": [
                    {"output_type": "stream", "name": "stdout", "text": ["cell output marker\n"]},
                    {"output_type": "display_data", "metadata": {}, "data": {"image/png": "QUJD" * 50}},
                ],
            },
        ],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }
).encode()

_HTML = (
    b"<html><head><title>Page title</title><script>var hidden_script = 1;</script><style>p{color:red}</style></head>"
    b"<body><p>html body marker</p></body></html>"
)

_Pages = list[tuple[int | None, str | None]]
_PAGED_PDF: _Pages = [(1, "1"), (2, "2"), (3, "3")]
_SINGLE: _Pages = [(None, None)]

# id -> (fixture name or literal bytes, file name, expected MIME type, markers, expected (pageNumber, label) list)
_FORMATS: dict[str, tuple[Any, str, str, list[str], _Pages]] = {
    "pdf": ("pdf_text", "a.pdf", "application/pdf", ["PDF page 1", "PDF page 2", "PDF page 3"], _PAGED_PDF),
    "pdf-owner-password-only": (
        "pdf_owner_password_only",
        "a.pdf",
        "application/pdf",
        ["PDF page 1", "PDF page 3"],
        _PAGED_PDF,
    ),
    "pdf-image-only": ("pdf_image_only", "scan.pdf", "application/pdf", [], _SINGLE),
    "pptx": (
        "pptx_multi_slide",
        "a.pptx",
        PPTX,
        ["Slide One", "second slide body", "Slide Three"],
        [(1, "1"), (2, "2"), (3, "3")],
    ),
    "xlsx-multi-sheet": (
        "xlsx_multi_sheet",
        "a.xlsx",
        XLSX,
        ["りんご", "Total"],
        [(1, "売上"), (2, "Summary <#1>")],
    ),
    "xlsx-single-sheet": ("xlsx_single_sheet", "a.xlsx", XLSX, ["single sheet marker"], [(1, "OnlySheet")]),
    "xlsx-hidden-sheet": (
        "xlsx_hidden_sheet",
        "a.xlsx",
        XLSX,
        ["visible marker", "hidden marker"],
        [(1, "Visible"), (2, "Secret")],
    ),
    "xlsx-chart-sheet": ("xlsx_chart_sheet", "a.xlsx", XLSX, ["Jan", "Mar"], [(1, "Data")]),
    "docx": (make_docx("docx marker 日本語"), "a.docx", DOCX, ["docx marker 日本語"], _SINGLE),
    "rtf": ("rtf", "a.rtf", "application/rtf", ["RTF body marker", "情報システム"], _SINGLE),
    "epub": ("epub", "a.epub", "application/epub+zip", ["EPUB chapter marker"], _SINGLE),
    "odt": ("odt", "a.odt", "application/vnd.oasis.opendocument.text", ["OpenDocument text marker"], _SINGLE),
    "ods": (
        "ods",
        "a.ods",
        "application/vnd.oasis.opendocument.spreadsheet",
        ["OpenDocument sheet marker", "second sheet"],
        _SINGLE,
    ),
    "odp": ("odp", "a.odp", "application/vnd.oasis.opendocument.presentation", ["OpenDocument slide marker"], _SINGLE),
    "doc": ("legacy_doc", "a.doc", "application/msword", ["This text is below the table."], _SINGLE),
    "ppt": ("legacy_ppt", "a.ppt", "application/vnd.ms-powerpoint", ["Text in a TextBox"], _SINGLE),
    "xls": ("xls", "a.xls", "application/vnd.ms-excel", ["XLS cell marker", "second sheet"], _SINGLE),
    "html": (_HTML, "a.html", "text/html", ["Page title", "html body marker"], _SINGLE),
    "xml": (b"<root><item>xml marker</item></root>", "a.xml", "text/xml", ["xml marker"], _SINGLE),
    "ipynb": (
        _IPYNB,
        "a.ipynb",
        "application/x-ipynb+json",
        ["Notebook title", "cell source marker", "cell output marker"],
        _SINGLE,
    ),
    "csv": (b"name,qty\napple,3\n", "a.csv", "text/csv", ["| name | qty |", "| apple | 3 |"], _SINGLE),
    "tsv": (
        b"name\tqty\napple\t3\n",
        "a.tsv",
        "text/tab-separated-values",
        ["| name | qty |", "| apple | 3 |"],
        _SINGLE,
    ),
    "txt": (b"plain text marker", "a.txt", "text/plain", ["plain text marker"], _SINGLE),
    "md": (b"# Heading\n\nmarkdown marker", "a.md", "text/markdown", ["markdown marker"], _SINGLE),
    "json": (b'{"key": "json marker"}', "a.json", "application/json", ["json marker"], _SINGLE),
    "yaml": (b"key: yaml marker\n", "a.yaml", "text/yaml", ["yaml marker"], _SINGLE),
    "shift-jis": ("text_shift_jis", "sjis.txt", "text/plain", [JAPANESE_SAMPLE], _SINGLE),
    "euc-jp": ("text_euc_jp", "euc.txt", "text/plain", [JAPANESE_SAMPLE], _SINGLE),
    "utf8-bom": ("text_utf8_bom", "bom.txt", "text/plain", [JAPANESE_SAMPLE], _SINGLE),
}


class TestFormatsOverHttp:
    """POST /extract returns the unit, number and label the design assigns to each format."""

    @pytest.mark.parametrize("case", list(_FORMATS))
    def test_unit_number_label_and_mime_type(
        self, case: str, default_client: TestClient, request: pytest.FixtureRequest
    ) -> None:
        source, filename, mime_type, markers, expected_pages = _FORMATS[case]
        data = request.getfixturevalue(source) if isinstance(source, str) else source
        if isinstance(data, Path):
            data = data.read_bytes()

        response = _post(default_client, filename, data)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["mimeType"] == mime_type
        assert [(p["pageNumber"], p["label"]) for p in body["pages"]] == expected_pages
        everything = "\n".join(p["content"] for p in body["pages"])
        for marker in markers:
            assert marker in everything
        assert body["extractedCharacters"] == sum(len(p["content"]) for p in body["pages"])

    def test_multi_sheet_xlsx_keeps_each_sheet_text_in_its_own_element(
        self, default_client: TestClient, xlsx_multi_sheet: bytes
    ) -> None:
        pages = _post(default_client, "a.xlsx", xlsx_multi_sheet).json()["pages"]
        assert "りんご" in pages[0]["content"] and "Total" not in pages[0]["content"]
        assert "Total" in pages[1]["content"] and "りんご" not in pages[1]["content"]

    def test_empty_xlsx_and_chart_sheets_get_no_element(
        self, default_client: TestClient, xlsx_multi_sheet: bytes
    ) -> None:
        labels = [p["label"] for p in _post(default_client, "a.xlsx", xlsx_multi_sheet).json()["pages"]]
        assert "Empty" not in labels

    def test_ipynb_never_returns_embedded_image_data(self, default_client: TestClient) -> None:
        text = _post(default_client, "a.ipynb", _IPYNB).json()["pages"][0]["content"]
        assert "QUJD" not in text

    def test_html_drops_script_and_style_content(self, default_client: TestClient) -> None:
        text = _post(default_client, "a.html", _HTML).json()["pages"][0]["content"]
        assert "hidden_script" not in text and "color:red" not in text

    def test_xml_entities_are_not_expanded(self, default_client: TestClient) -> None:
        bomb = b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;">]><r>&b;</r>'
        response = _post(default_client, "a.xml", bomb)
        assert response.status_code == 200
        assert "AAAAAAAAAA" not in response.json()["pages"][0]["content"]

    def test_mime_type_hint_decides_a_file_without_an_extension(self, default_client: TestClient) -> None:
        response = _post(default_client, "no-extension", b"hinted text", "text/plain")
        assert response.status_code == 200
        assert response.json()["pages"][0]["content"] == "hinted text"

    def test_legacy_pdf_page_text_has_no_gap_closing_for_ascii(
        self, default_client: TestClient, pdf_text: bytes
    ) -> None:
        pages = _post(default_client, "a.pdf", pdf_text).json()["pages"]
        assert [p["content"] for p in pages] == ["PDF page 1", "PDF page 2", "PDF page 3"]


class TestLineBreaksOverHttp:
    """Req 1.9: only PDF closes gaps between Japanese lines; text the author broke by hand stays as written."""

    def test_pdf_closes_a_line_break_between_japanese_characters(self, default_client: TestClient) -> None:
        pages = _post(default_client, "j.pdf", _japanese_lines_pdf(["日本", "語です"])).json()["pages"]
        assert pages[0]["content"].strip() == "日本語です"

    def test_pdf_keeps_a_line_break_between_japanese_and_ascii(self, default_client: TestClient) -> None:
        pages = _post(default_client, "j.pdf", _japanese_lines_pdf(["日本", "ABC"])).json()["pages"]
        assert "日本\nABC" in pages[0]["content"]

    def test_txt_keeps_the_authors_line_break_between_japanese_characters(self, default_client: TestClient) -> None:
        pages = _post(default_client, "a.txt", "情報シス\nテム".encode()).json()["pages"]
        assert pages[0]["content"] == "情報シス\nテム"

    def test_docx_keeps_a_line_break_between_japanese_characters(self, default_client: TestClient) -> None:
        content = _post(default_client, "a.docx", make_docx("情報シス\nテム")).json()["pages"][0]["content"]
        assert "情報システム" not in content
        assert "情報シス" in content and "テム" in content

    def test_crlf_in_text_is_normalised_to_lf(self, default_client: TestClient) -> None:
        pages = _post(default_client, "a.txt", b"one\r\ntwo\rthree").json()["pages"]
        assert pages[0]["content"] == "one\ntwo\nthree"


# ---------------------------------------------------------------------------
# 2. Error table with default settings
# ---------------------------------------------------------------------------

_ERROR_ROWS: dict[str, tuple[Any, str, int, str, str]] = {
    # id -> (fixture name or bytes, file name, HTTP status, ErrorCode, failure kind in the message)
    "msg-is-unsupported": (b"\xd0\xcf\x11\xe0 outlook message", "mail.msg", 400, "unsupported_format", "unsupported"),
    "unknown-extension": (b"whatever", "data.zzz", 400, "unsupported_format", "unsupported"),
    "no-extension": (b"whatever", "README", 400, "unsupported_format", "unsupported"),
    "encrypted-docx": ("docx_encrypted", "a.docx", 422, "file_encrypted", "encrypted"),
    "encrypted-xlsx": ("xlsx_encrypted", "a.xlsx", 422, "file_encrypted", "encrypted"),
    "encrypted-pptx": ("pptx_encrypted", "a.pptx", 422, "file_encrypted", "encrypted"),
    "user-password-pdf": ("pdf_user_password", "a.pdf", 422, "file_encrypted", "encrypted"),
    "corrupt-pdf": ("pdf_corrupt", "a.pdf", 422, "extraction_failed", "malformed"),
    "corrupt-docx": (b"PK\x03\x04 not really a zip", "a.docx", 422, "extraction_failed", "malformed"),
    "not-a-pdf": (b"plain text with a pdf name", "a.pdf", 422, "extraction_failed", "malformed"),
    "deeply-nested-docx": ("docx_deeply_nested", "a.docx", 422, "resource_limit_exceeded", "limit_exceeded"),
    "xlsx-over-cell-limit": ("xlsx_over_cell_limit_path", "a.xlsx", 422, "resource_limit_exceeded", "limit_exceeded"),
    "zip-bomb-docx": ("docx_zip_bomb_path", "a.docx", 422, "resource_limit_exceeded", "limit_exceeded"),
}


def _row_bytes(source: Any, request: pytest.FixtureRequest) -> bytes:  # noqa: ANN401
    data = request.getfixturevalue(source) if isinstance(source, str) else source
    return data.read_bytes() if isinstance(data, Path) else data


class TestErrorTableOverHttp:
    @pytest.mark.parametrize("case", list(_ERROR_ROWS))
    def test_each_row_gives_its_code_and_status(
        self, case: str, default_client: TestClient, request: pytest.FixtureRequest
    ) -> None:
        source, filename, status, code, kind = _ERROR_ROWS[case]
        response = _post(default_client, filename, _row_bytes(source, request))
        _assert_error(response, status, code, kind)

    @pytest.mark.parametrize("headers", [None, {"Authorization": "Bearer wrong-token"}, {"Authorization": "Basic abc"}])
    def test_missing_or_invalid_token_is_401(self, headers: dict | None, default_client: TestClient) -> None:
        response = _post(default_client, "a.txt", b"hello", headers=headers)
        assert response.status_code == 401
        assert response.json()["code"] == "unauthorized"
        assert "hello" not in response.text

    def test_a_failure_does_not_poison_the_next_request(self, default_client: TestClient, pdf_corrupt: bytes) -> None:
        assert _post(default_client, "a.pdf", pdf_corrupt).status_code == 422
        assert _post(default_client, "a.txt", b"still serving").status_code == 200
        _assert_no_stray_children()


# ---------------------------------------------------------------------------
# 3. Hygiene: nothing from the upload comes back in an error body or into the logs
# ---------------------------------------------------------------------------

_HYGIENE_CASES = {
    "corrupt-docx": (b"PK\x03\x04" + CONTENT_MARKER.encode(), f"{FILE_NAME_MARKER}.docx", 422),
    "corrupt-pdf": (b"%PDF-1.4\n" + CONTENT_MARKER.encode(), f"{FILE_NAME_MARKER}.pdf", 422),
    "corrupt-xlsx": (b"PK\x03\x04" + CONTENT_MARKER.encode(), f"{FILE_NAME_MARKER}.xlsx", 422),
    "unsupported": (CONTENT_MARKER.encode(), f"{FILE_NAME_MARKER}.msg", 400),
    "unknown-extension": (CONTENT_MARKER.encode(), f"{FILE_NAME_MARKER}.zzz", 400),
}


class TestHygieneOverHttp:
    @pytest.mark.parametrize("case", list(_HYGIENE_CASES))
    def test_error_response_carries_neither_content_nor_file_name(
        self, case: str, default_client: TestClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        data, filename, status = _HYGIENE_CASES[case]
        with caplog.at_level(logging.DEBUG):
            response = _post(default_client, filename, data)

        assert response.status_code == status
        assert CONTENT_MARKER not in response.text
        assert FILE_NAME_MARKER not in response.text
        assert set(response.json()) == {"code", "message"}
        assert CONTENT_MARKER not in caplog.text

    def test_success_log_does_not_contain_the_extracted_text(
        self, default_client: TestClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.DEBUG):
            assert _post(default_client, "a.txt", CONTENT_MARKER.encode()).status_code == 200
        assert CONTENT_MARKER not in caplog.text

    def test_the_bearer_token_never_appears_in_the_logs(
        self, default_client: TestClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.DEBUG):
            _post(default_client, "a.txt", b"x")
            _post(default_client, "a.txt", b"x", headers={"Authorization": "Bearer leaked-token-value"})
        assert TOKEN not in caplog.text
        assert "leaked-token-value" not in caplog.text


# ---------------------------------------------------------------------------
# 4. Request shape
# ---------------------------------------------------------------------------


class TestRequestShapeOverHttp:
    def test_missing_file_field_is_a_422_validation_error(self, default_client: TestClient) -> None:
        response = default_client.post("/extract", headers=AUTH, data={"mimeType": "text/plain"})
        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "file"]

    def test_empty_text_file_is_one_empty_element(self, default_client: TestClient) -> None:
        response = _post(default_client, "empty.txt", b"")
        assert response.status_code == 200
        body = response.json()
        assert body["pages"] == [{"pageNumber": None, "label": None, "content": ""}]
        assert body["extractedCharacters"] == 0

    @pytest.mark.parametrize("name", ["empty.pdf", "empty.docx", "empty.xlsx"])
    def test_empty_binary_format_is_a_malformed_422(self, name: str, default_client: TestClient) -> None:
        _assert_error(_post(default_client, name, b""), 422, "extraction_failed", "malformed")

    def test_empty_file_with_unknown_extension_is_unsupported(self, default_client: TestClient) -> None:
        _assert_error(_post(default_client, "empty.zzz", b""), 400, "unsupported_format", "unsupported")

    def test_a_multi_part_upload_without_a_file_name_is_not_a_server_error(self, default_client: TestClient) -> None:
        response = default_client.post("/extract", headers=AUTH, files={"file": ("", b"text")})
        assert response.status_code < 500


# ---------------------------------------------------------------------------
# 5. Error rows that need non-default settings (each gets its own app)
# ---------------------------------------------------------------------------


class TestSizeAndLimitRowsOverHttp:
    def test_file_over_the_size_limit_is_413_and_the_limit_itself_is_accepted(self) -> None:
        with _serve({"MAX_FILE_SIZE_MB": 1}) as client:
            _assert_error(_post(client, "big.txt", b"x" * (MIB + 1)), 413, "file_too_large", "")
            assert _post(client, "ok.txt", b"x" * MIB).status_code == 200

    def test_size_check_uses_the_real_body_not_the_declared_length(self) -> None:
        with _serve({"MAX_FILE_SIZE_MB": 1}) as client:
            response = client.post("/extract", headers=AUTH, files={"file": ("a.txt", b"x" * (MIB + 1))})
            assert response.status_code == 413

    def test_pdf_over_the_page_limit_is_resource_limit_exceeded(self, pdf_text: bytes) -> None:
        with _serve({"MAX_PDF_PAGES": 2}) as client:
            _assert_error(_post(client, "a.pdf", pdf_text), 422, "resource_limit_exceeded", "limit_exceeded")

    def test_pdf_at_the_page_limit_is_accepted(self, pdf_text: bytes) -> None:
        with _serve({"MAX_PDF_PAGES": 3}) as client:
            assert _post(client, "a.pdf", pdf_text).status_code == 200

    def test_result_over_the_size_limit_is_resource_limit_exceeded(self) -> None:
        with _serve({"MAX_RESULT_BYTES": 1000}) as client:
            _assert_error(_post(client, "a.txt", b"y" * 5000), 422, "resource_limit_exceeded", "result_too_large")
            assert _post(client, "a.txt", b"short").status_code == 200

    def test_child_over_the_memory_limit_is_resource_limit_exceeded(self) -> None:
        with _serve({"MAX_CHILD_RSS_MB": 96}, child_target=child_targets.grow_memory_target) as client:
            # The file name is the number of 8 MiB blocks the stand-in child allocates.
            _assert_error(_post(client, "60", b"x"), 422, "resource_limit_exceeded", "memory_exceeded")
        _assert_no_stray_children()


class TestTimeoutRowOverHttp:
    def test_deadline_exceeded_is_408_and_the_next_request_succeeds(self, xlsx_large_for_timeout_path: Path) -> None:
        data = xlsx_large_for_timeout_path.read_bytes()
        with _serve({"MAX_CONCURRENCY": 1}, timeout_s=0.2) as client:
            began = time.monotonic()
            _assert_error(_post(client, "big.xlsx", data), 408, "extraction_timeout", "timeout")
            assert time.monotonic() - began < 15
            _assert_no_stray_children()
            # The only slot came back and the killed child left nothing behind.
            assert _post(client, "a.txt", b"after the timeout").status_code == 200
            _assert_no_stray_children()

    def test_child_that_burns_cpu_past_its_limit_is_408(self) -> None:
        with _serve({"MAX_CONCURRENCY": 1}, timeout_s=20.0, child_target=child_targets.cpu_overrun_target) as client:
            _assert_error(_post(client, "a.txt", b"spin"), 408, "extraction_timeout", "timeout")
            _assert_no_stray_children()


class TestChildFailureRowsOverHttp:
    @pytest.mark.parametrize(
        ("filename", "kind"),
        [("abort", "crashed"), ("segfault", "crashed")],
    )
    def test_a_dying_child_is_500_and_the_service_keeps_serving(self, filename: str, kind: str) -> None:
        with _serve({"MAX_CONCURRENCY": 1}, child_target=child_targets.crash_or_convert_target) as client:
            _assert_error(_post(client, filename, b"x"), 500, "extraction_failed", kind)
            _assert_no_stray_children()
            assert _post(client, "a.txt", b"alive").status_code == 200

    def test_killed_child_stands_in_for_the_oom_killer(self) -> None:
        with _serve({"MAX_CONCURRENCY": 1}, child_target=child_targets.sigkill_self_target) as client:
            _assert_error(_post(client, "a.txt", b"x"), 500, "extraction_failed", "crashed")

    def test_unexpected_exception_in_the_child_is_500_internal(self) -> None:
        with _serve({"MAX_CONCURRENCY": 1}, child_target=child_targets.panic_in_convert_target) as client:
            response = _post(client, "a.txt", CONTENT_MARKER.encode())
            _assert_error(response, 500, "extraction_failed", "internal")
            assert "index out of bounds" not in response.text
            assert CONTENT_MARKER not in response.text

    def test_garbage_result_from_the_child_is_500(self) -> None:
        with _serve(child_target=child_targets.garbage_result_target) as client:
            assert _post(client, "a.txt", b"x").status_code == 500


def _all_slots_taken() -> bool:
    from app.routers import extract as extract_router

    limits = extract_router.limits
    return limits is not None and limits._semaphore.locked()


class TestServiceBusyOverHttp:
    def test_when_every_slot_is_taken_a_second_request_gets_503_at_once(self) -> None:
        # delayed_echo_target sleeps for as many seconds as the file name says.
        with _serve({"MAX_CONCURRENCY": 1}, child_target=child_targets.delayed_echo_target) as client:
            first: dict[str, Any] = {}

            def slow_request() -> None:
                first["response"] = _post(client, "4", b"slow")

            worker = threading.Thread(target=slow_request)
            worker.start()
            try:
                # Probing before the slow request has its slot would let the probe take the slot instead.
                deadline = time.monotonic() + 10
                while not _all_slots_taken() and time.monotonic() < deadline:
                    time.sleep(0.02)
                assert _all_slots_taken(), "the slow request never took the only slot"
                began = time.monotonic()
                response = _post(client, "0", b"probe")
                elapsed = time.monotonic() - began
                _assert_error(response, 503, "service_busy", "")
                assert elapsed < 2.0
            finally:
                worker.join(timeout=30)

            assert first["response"].status_code == 200
            assert "received 4 bytes" in first["response"].json()["pages"][0]["content"]
            # The slot is free again and the child is gone.
            assert _post(client, "0", b"after").status_code == 200
            _assert_no_stray_children()
