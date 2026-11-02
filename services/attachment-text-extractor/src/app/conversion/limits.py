"""Limits handed from the parent process to the conversion child."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.conversion.errors import ConversionError

if TYPE_CHECKING:
    from app.config import Settings
    from app.conversion.formats import ResolvedFormat

# Fixed on purpose: it bounds a single notebook output and is not an operational knob.
IPYNB_OUTPUT_MAX_CHARS = 10_000


@dataclass(frozen=True)
class ConversionLimits:
    max_child_rss_mb: int
    max_result_bytes: int
    max_pdf_pages: int
    max_archive_entries: int
    max_archive_uncompressed_mb: int
    max_xlsx_cells: int
    ipynb_output_max_chars: int
    max_csv_bytes: int
    max_html_bytes: int

    @classmethod
    def from_settings(cls, settings: Settings) -> ConversionLimits:
        return cls(
            max_child_rss_mb=settings.MAX_CHILD_RSS_MB,
            max_result_bytes=settings.MAX_RESULT_BYTES,
            max_pdf_pages=settings.MAX_PDF_PAGES,
            max_archive_entries=settings.MAX_ARCHIVE_ENTRIES,
            max_archive_uncompressed_mb=settings.MAX_ARCHIVE_UNCOMPRESSED_MB,
            max_xlsx_cells=settings.MAX_XLSX_CELLS,
            ipynb_output_max_chars=IPYNB_OUTPUT_MAX_CHARS,
            max_csv_bytes=settings.MAX_CSV_BYTES,
            max_html_bytes=settings.MAX_HTML_BYTES,
        )


def check_input_size(resolved: ResolvedFormat, size: int, limits: ConversionLimits) -> None:
    """Raise `limit_exceeded` for an input over its format's size cap; formats without a cap always pass.

    Pure and free of conversion libraries, so the parent can call it before starting a child.
    """
    cap = _input_size_cap(resolved, limits)
    if cap is not None and size > cap:
        raise ConversionError("limit_exceeded", "input exceeds the size limit for its format")


def _input_size_cap(resolved: ResolvedFormat, limits: ConversionLimits) -> int | None:
    # CSV and TSV share the text kind "csv".
    if resolved.text_kind == "csv":
        return limits.max_csv_bytes
    if resolved.text_kind == "html":
        return limits.max_html_bytes
    return None
