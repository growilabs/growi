"""Format resolver tests. The expected table is written out from design.md (FormatResolver)."""

import pytest

from app.conversion.errors import ConversionError
from app.conversion.formats import ResolvedFormat, resolve_format

PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# (mime, extension, route, anydoc_format, text_kind)
ROWS = [
    ("application/pdf", "pdf", "pdf", None, None),
    (PPTX_MIME, "pptx", "pptx", "pptx", None),
    (XLSX_MIME, "xlsx", "xlsx", "xlsx", None),
    (DOCX_MIME, "docx", "office", "docx", None),
    ("application/rtf", "rtf", "office", "rtf", None),
    ("application/epub+zip", "epub", "office", "epub", None),
    ("application/msword", "doc", "office", "doc", None),
    ("application/vnd.ms-powerpoint", "ppt", "office", "ppt", None),
    ("application/vnd.ms-excel", "xls", "office", "xlsx", None),
    ("application/vnd.oasis.opendocument.text", "odt", "office", "odt", None),
    ("application/vnd.oasis.opendocument.spreadsheet", "ods", "office", "ods", None),
    ("application/vnd.oasis.opendocument.presentation", "odp", "office", "odp", None),
    ("text/csv", "csv", "text", "csv", "csv"),
    ("text/tab-separated-values", "tsv", "text", "csv", "csv"),
    ("text/html", "html", "text", None, "html"),
    ("text/html", "htm", "text", None, "html"),
    ("text/xml", "xml", "text", None, "xml"),
    ("application/xml", "xml", "text", None, "xml"),
    ("application/x-ipynb+json", "ipynb", "text", None, "ipynb"),
    ("text/plain", "txt", "text", None, "plain"),
    ("text/plain", "log", "text", None, "plain"),
    ("text/markdown", "md", "text", None, "plain"),
    ("application/json", "json", "text", None, "plain"),
    ("text/yaml", "yaml", "text", None, "plain"),
    ("text/yaml", "yml", "text", None, "plain"),
]


@pytest.mark.parametrize(("mime", "ext", "route", "fmt", "kind"), ROWS)
def test_mime_hint_alone_decides_route_and_format(mime, ext, route, fmt, kind):
    resolved = resolve_format("no-extension-here", mime)
    assert (resolved.route, resolved.anydoc_format, resolved.text_kind) == (route, fmt, kind)


@pytest.mark.parametrize(("mime", "ext", "route", "fmt", "kind"), ROWS)
def test_extension_alone_decides_route_and_format(mime, ext, route, fmt, kind):
    resolved = resolve_format(f"report.{ext}", None)
    assert (resolved.route, resolved.anydoc_format, resolved.text_kind) == (route, fmt, kind)


@pytest.mark.parametrize(("mime", "ext", "route", "fmt", "kind"), ROWS)
def test_extension_is_case_insensitive(mime, ext, route, fmt, kind):
    resolved = resolve_format(f"REPORT.{ext.upper()}", None)
    assert (resolved.route, resolved.anydoc_format, resolved.text_kind) == (route, fmt, kind)


@pytest.mark.parametrize(("mime", "ext", "route", "fmt", "kind"), ROWS)
def test_mime_is_case_insensitive_and_reported_in_lowercase(mime, ext, route, fmt, kind):
    resolved = resolve_format("x", mime.upper())
    assert resolved.route == route
    assert resolved.mime_type == mime


def test_xls_is_passed_to_anydoc_as_xlsx():
    resolved = resolve_format("old.xls", None)
    assert resolved.route == "office"
    assert resolved.anydoc_format == "xlsx"


@pytest.mark.parametrize(
    "mime", ["text/plain; charset=utf-8", "text/plain;charset=Shift_JIS", "TEXT/PLAIN ; charset=utf-8"]
)
def test_mime_parameters_are_ignored(mime):
    resolved = resolve_format("a.bin", mime)
    assert resolved == ResolvedFormat(mime_type="text/plain", route="text", anydoc_format=None, text_kind="plain")


@pytest.mark.parametrize(
    "mime", ["application/octet-stream", "binary/octet-stream", "application/x-unknown", "", "   "]
)
def test_generic_or_unknown_mime_falls_back_to_extension(mime):
    resolved = resolve_format("slides.pptx", mime)
    assert resolved.route == "pptx"
    assert resolved.mime_type == PPTX_MIME


def test_mime_in_table_wins_over_conflicting_extension():
    resolved = resolve_format("misnamed.docx", "application/pdf")
    assert resolved.route == "pdf"
    assert resolved.mime_type == "application/pdf"


def test_extension_decides_when_mime_is_none_and_name_has_dots():
    assert resolve_format("v1.2.final.pdf", None).route == "pdf"


@pytest.mark.parametrize(
    ("filename", "mime"),
    [
        ("mail.msg", "application/vnd.ms-outlook"),
        ("mail.msg", None),
        ("mail.MSG", "application/octet-stream"),
        ("archive.zip", None),
        ("noextension", None),
        ("noextension", "application/octet-stream"),
        ("trailingdot.", None),
        ("image.png", "image/png"),
    ],
)
def test_unsupported_formats_raise_unsupported(filename, mime):
    with pytest.raises(ConversionError) as excinfo:
        resolve_format(filename, mime)
    assert excinfo.value.kind == "unsupported"
