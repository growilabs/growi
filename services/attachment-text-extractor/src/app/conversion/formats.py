"""Format and route types produced by the format resolver."""

from dataclasses import dataclass
from typing import Literal

from app.conversion.errors import ConversionError

AnydocFormat = Literal["doc", "docx", "odt", "ppt", "pptx", "rtf", "epub", "xlsx", "ods", "odp", "csv"]

# plain = TXT / MD / LOG / JSON / YAML, csv = CSV / TSV
TextKind = Literal["plain", "html", "xml", "ipynb", "csv"]

Route = Literal["pdf", "pptx", "xlsx", "office", "text"]


@dataclass(frozen=True)
class ResolvedFormat:
    mime_type: str
    route: Route
    anydoc_format: AnydocFormat | None  # used by the office / pptx / xlsx routes
    text_kind: TextKind | None  # used by the text route


@dataclass(frozen=True)
class _Entry:
    mime_type: str  # canonical MIME reported back for this format
    route: Route
    anydoc_format: AnydocFormat | None
    text_kind: TextKind | None


_PPTX = _Entry("application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", "pptx", None)
_XLSX = _Entry("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", "xlsx", None)
_DOCX = _Entry("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "office", "docx", None)
_CSV = _Entry("text/csv", "text", "csv", "csv")
_TSV = _Entry("text/tab-separated-values", "text", "csv", "csv")
_HTML = _Entry("text/html", "text", None, "html")
_XML = _Entry("text/xml", "text", None, "xml")
_PLAIN = _Entry("text/plain", "text", None, "plain")
_MARKDOWN = _Entry("text/markdown", "text", None, "plain")
_JSON = _Entry("application/json", "text", None, "plain")
_YAML = _Entry("text/yaml", "text", None, "plain")
# anydoc handles legacy XLS under the format name "xlsx".
_XLS = _Entry("application/vnd.ms-excel", "office", "xlsx", None)

_BY_MIME: dict[str, _Entry] = {
    "application/pdf": _Entry("application/pdf", "pdf", None, None),
    _PPTX.mime_type: _PPTX,
    _XLSX.mime_type: _XLSX,
    _DOCX.mime_type: _DOCX,
    "application/rtf": _Entry("application/rtf", "office", "rtf", None),
    "application/epub+zip": _Entry("application/epub+zip", "office", "epub", None),
    "application/msword": _Entry("application/msword", "office", "doc", None),
    "application/vnd.ms-powerpoint": _Entry("application/vnd.ms-powerpoint", "office", "ppt", None),
    _XLS.mime_type: _XLS,
    "application/vnd.oasis.opendocument.text": _Entry("application/vnd.oasis.opendocument.text", "office", "odt", None),
    "application/vnd.oasis.opendocument.spreadsheet": _Entry(
        "application/vnd.oasis.opendocument.spreadsheet", "office", "ods", None
    ),
    "application/vnd.oasis.opendocument.presentation": _Entry(
        "application/vnd.oasis.opendocument.presentation", "office", "odp", None
    ),
    _CSV.mime_type: _CSV,
    _TSV.mime_type: _TSV,
    _HTML.mime_type: _HTML,
    "text/xml": _XML,
    "application/xml": _Entry("application/xml", "text", None, "xml"),
    "application/x-ipynb+json": _Entry("application/x-ipynb+json", "text", None, "ipynb"),
    _PLAIN.mime_type: _PLAIN,
    _MARKDOWN.mime_type: _MARKDOWN,
    _JSON.mime_type: _JSON,
    _YAML.mime_type: _YAML,
    "application/yaml": _Entry("application/yaml", "text", None, "plain"),
    "application/x-yaml": _Entry("application/x-yaml", "text", None, "plain"),
}

_BY_EXTENSION: dict[str, _Entry] = {
    "pdf": _BY_MIME["application/pdf"],
    "pptx": _PPTX,
    "xlsx": _XLSX,
    "docx": _DOCX,
    "rtf": _BY_MIME["application/rtf"],
    "epub": _BY_MIME["application/epub+zip"],
    "doc": _BY_MIME["application/msword"],
    "ppt": _BY_MIME["application/vnd.ms-powerpoint"],
    "xls": _XLS,
    "odt": _BY_MIME["application/vnd.oasis.opendocument.text"],
    "ods": _BY_MIME["application/vnd.oasis.opendocument.spreadsheet"],
    "odp": _BY_MIME["application/vnd.oasis.opendocument.presentation"],
    "csv": _CSV,
    "tsv": _TSV,
    "html": _HTML,
    "htm": _HTML,
    "xml": _XML,
    "ipynb": _BY_MIME["application/x-ipynb+json"],
    "txt": _PLAIN,
    "log": _PLAIN,
    "md": _MARKDOWN,
    "json": _JSON,
    "yaml": _YAML,
    "yml": _YAML,
}


def resolve_format(filename: str, mime_hint: str | None) -> ResolvedFormat:
    """Decide route and anydoc format. A MIME hint in the table wins; otherwise the extension decides (Req 1.5, 1.8)."""
    entry = _lookup_mime(mime_hint) or _lookup_extension(filename)
    if entry is None:
        # Outlook MSG is deliberately absent from the tables (Req 1.6).
        raise ConversionError("unsupported", "format is not supported")
    return ResolvedFormat(
        mime_type=entry.mime_type,
        route=entry.route,
        anydoc_format=entry.anydoc_format,
        text_kind=entry.text_kind,
    )


def _lookup_mime(mime_hint: str | None) -> _Entry | None:
    if mime_hint is None:
        return None
    # Parameters such as "; charset=utf-8" are not part of the media type.
    return _BY_MIME.get(mime_hint.split(";", 1)[0].strip().lower())


def _lookup_extension(filename: str) -> _Entry | None:
    _, dot, extension = filename.rpartition(".")
    if not dot:
        return None
    return _BY_EXTENSION.get(extension.strip().lower())
