"""Mapping from the runner's failure kinds to the HTTP error contract.

Mirrors design.md "Error Categories and Responses". The dict is keyed by every FailureKind so
a new kind cannot be added without deciding its response.
"""

from __future__ import annotations

from typing import Final

from app.conversion.errors import FailureKind
from app.schemas import ErrorCode

# Fixed texts: neither the child's detail nor anything derived from the file may reach the client.
FAILURE_RESPONSES: Final[dict[FailureKind, tuple[ErrorCode, int, str]]] = {
    "unsupported": (ErrorCode.unsupported_format, 400, "unsupported: this file format is not supported"),
    "encrypted": (ErrorCode.file_encrypted, 422, "encrypted: the document is password-protected"),
    "malformed": (ErrorCode.extraction_failed, 422, "malformed: the document could not be read"),
    "limit_exceeded": (
        ErrorCode.resource_limit_exceeded,
        422,
        "limit_exceeded: the document exceeds a processing limit",
    ),
    "memory_exceeded": (
        ErrorCode.resource_limit_exceeded,
        422,
        "memory_exceeded: the document needs more memory than allowed",
    ),
    "result_too_large": (
        ErrorCode.resource_limit_exceeded,
        422,
        "result_too_large: the extracted text exceeds the allowed size",
    ),
    "timeout": (ErrorCode.extraction_timeout, 408, "timeout: the extraction took too long"),
    "crashed": (ErrorCode.extraction_failed, 500, "crashed: the extraction process ended unexpectedly"),
    "internal": (ErrorCode.extraction_failed, 500, "internal: unexpected extraction error"),
}
