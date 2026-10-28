"""Limits handed from the parent process to the conversion child."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.config import Settings

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
        )
