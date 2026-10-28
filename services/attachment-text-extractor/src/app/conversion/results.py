"""Outcome of one conversion, shared by the conversion layer and the runner."""

from dataclasses import dataclass

from app.conversion.errors import ConversionFailure
from app.schemas import PageInfo


@dataclass(frozen=True)
class ConversionSuccess:
    pages: list[PageInfo]
    mime_type: str
    # Set by the runner from its own /proc sampling; never sent over the wire by the child.
    child_peak_rss_mb: int | None = None


ConversionOutcome = ConversionSuccess | ConversionFailure
