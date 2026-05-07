"""Pydantic v2 schema definitions for the markitdown-extractor API.

Defines the data contracts for:
- POST /extract response body (ExtractResponse, PageInfo)
- Error responses (ErrorResponse, ErrorCode)
"""

from enum import Enum

from pydantic import BaseModel


class PageInfo(BaseModel):
    """Information extracted from a single logical page or section of a document.

    pageNumber and label are None when the source format has no positional
    page concept (e.g. plain text files).
    """

    pageNumber: int | None  # 1-based; None when the format has no page concept
    label: str | None  # Display label (slide number string / sheet name / page number string)
    content: str  # Extracted Markdown text for this page/section


class ExtractResponse(BaseModel):
    """Successful extraction response returned by POST /extract.

    extractedCharacters is the sum of len(page.content) across all pages and
    is provided for audit logging and metrics purposes (Req 1.1).
    """

    pages: list[PageInfo]
    mimeType: str  # MIME type as confirmed server-side
    extractedCharacters: int  # Total character count across all pages


class ErrorCode(str, Enum):
    """Machine-readable error codes for all defined failure modes.

    Extends str so that values serialize as plain JSON strings rather than
    enum objects, ensuring compatibility with FastAPI's OpenAPI generation.
    """

    unauthorized = "unauthorized"  # Req 3.3: missing or invalid Bearer token
    unsupported_format = "unsupported_format"  # Req 1.6: MIME type not supported
    file_too_large = "file_too_large"  # Req 2.1: upload exceeds MAX_FILE_SIZE_MB
    extraction_timeout = "extraction_timeout"  # Req 2.2: extraction exceeded TIMEOUT_S
    service_busy = "service_busy"  # Req 2.3: concurrency limit reached
    extraction_failed = "extraction_failed"  # General extraction error


class ErrorResponse(BaseModel):
    """Error response body returned for all 4xx/5xx responses from POST /extract."""

    code: ErrorCode
    message: str  # Human-readable description of the error
