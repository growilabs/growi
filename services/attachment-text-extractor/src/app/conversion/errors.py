"""Failure kinds shared by the conversion layer and the runner."""

from dataclasses import dataclass
from typing import Literal

FailureKind = Literal[
    "unsupported",  # Req 1.6
    "encrypted",  # Req 1.10
    "malformed",  # Req 1.11
    "limit_exceeded",  # Req 2.6: anydoc / archive guard / page-count limits
    "memory_exceeded",  # Req 2.6: parent stopped the child at the RSS limit
    "result_too_large",  # Req 2.6: result exceeded MAX_RESULT_BYTES
    "timeout",  # Req 2.2, 2.5
    "crashed",  # Req 2.7: child ended before sending a result
    "internal",  # Req 2.7: unexpected exception inside the child
]


@dataclass(frozen=True)
class ConversionFailure:
    kind: FailureKind
    detail: str  # Must never contain file contents; it ends up in logs and responses.
    # Set by the runner from its own /proc sampling; never sent over the wire by the child.
    child_peak_rss_mb: int | None = None


class ConversionError(Exception):
    """Raised inside the conversion layer; ConversionCore maps it to a FailureKind."""

    def __init__(self, kind: FailureKind, detail: str) -> None:
        super().__init__(f"{kind}: {detail}")
        self.kind: FailureKind = kind
        self.detail: str = detail
