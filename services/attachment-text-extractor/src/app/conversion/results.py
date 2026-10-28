"""Outcome of one conversion, shared by the conversion layer and the runner."""

from dataclasses import dataclass

from app.conversion.errors import ConversionFailure
from app.schemas import PageInfo


@dataclass(frozen=True)
class ConversionSuccess:
    pages: list[PageInfo]
    mime_type: str


ConversionOutcome = ConversionSuccess | ConversionFailure
