"""Format and route types produced by the format resolver."""

from dataclasses import dataclass
from typing import Literal

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
