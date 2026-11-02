"""Application configuration loaded from environment variables.

Uses pydantic-settings so that every setting can be overridden via the
environment or a `.env` file.  ATTACHMENT_EXTRACTOR_SERVICE_TOKEN has no default and
must be provided; the service will fail to start (fail-fast) if it is absent
or contains only whitespace.
"""

import logging

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Runtime configuration for the attachment-text-extractor service.

    All fields are read from environment variables (case-insensitive).
    A `.env` file in the working directory is also supported.

    Required:
        ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: Bearer token used to authenticate incoming
            POST /extract requests.  Must be non-empty.  Leaving it unset or
            supplying an empty/whitespace value raises ``ValidationError`` at
            startup — this is intentional fail-fast behaviour (Req 3.3).

    Optional (with defaults):
        MAX_FILE_SIZE_MB (int, default 50): Upper limit on the size of an
            uploaded file.  Requests that exceed this limit are rejected with
            HTTP 413 (Req 2.1).
        TIMEOUT_S (int, default 55): Maximum seconds allowed for a single
            extraction before the child process is killed (Req 2.2).  Keep it
            at least 5 seconds below the caller's timeout.
        UPLOAD_TIMEOUT_S (int, default 15): Maximum seconds for receiving one
            request body, counted from the moment its concurrency slot is taken.
            A slower upload is answered with HTTP 408 and frees the slot.
        MAX_CONCURRENCY (int, default 3): Maximum number of simultaneous
            extractions per worker.  The overall cap is workers x this value
            (Req 2.3).
        MAX_CHILD_RSS_MB (int, default 320): RSS ceiling for one conversion
            child process (Req 2.6).
        MAX_XLSX_CELLS (int, default 70000): Maximum total cell count across
            all sheets of an XLSX file (Req 2.6).  A single sheet at this size
            stays under the default MAX_CHILD_RSS_MB.
        MAX_RESULT_BYTES (int, default 16 MiB): Maximum total size of one
            extraction result (Req 2.6).
        MAX_PDF_PAGES (int, default 5000): Maximum PDF page count (Req 2.6).
        MAX_ARCHIVE_ENTRIES (int, default 10000): Maximum ZIP entry count for
            PPTX / XLSX (Req 2.6).
        MAX_ARCHIVE_UNCOMPRESSED_MB (int, default 512): Maximum declared
            uncompressed size of a ZIP archive (Req 2.6).
        MAX_CSV_BYTES (int, default 8 MiB): Maximum size of a CSV / TSV file,
            checked before a conversion child is started (Req 2.6).  anydoc
            needs about 36x the input, so a larger CSV would not fit under the
            default MAX_CHILD_RSS_MB anyway.
        MAX_HTML_BYTES (int, default 20 MiB): Maximum size of an HTML file,
            checked before a conversion child is started (Req 2.6).
        LOG_LEVEL (str, default "INFO"): Python ``logging`` level name for the
            ``app`` loggers; an unknown name fails at startup.
    """

    # --- Limits (Reqs 2.1, 2.2, 2.3, 2.6) ---
    MAX_FILE_SIZE_MB: int = 50
    TIMEOUT_S: int = 55
    UPLOAD_TIMEOUT_S: int = Field(default=15, gt=0)
    MAX_CONCURRENCY: int = 3
    MAX_CHILD_RSS_MB: int = 320
    MAX_XLSX_CELLS: int = 70_000
    MAX_RESULT_BYTES: int = 16 * 1024 * 1024
    MAX_PDF_PAGES: int = 5000
    MAX_ARCHIVE_ENTRIES: int = 10_000
    MAX_ARCHIVE_UNCOMPRESSED_MB: int = 512
    MAX_CSV_BYTES: int = Field(default=8 * 1024 * 1024, gt=0)
    MAX_HTML_BYTES: int = Field(default=20 * 1024 * 1024, gt=0)

    # --- Observability ---
    LOG_LEVEL: str = "INFO"

    # --- Security (Req 3.3) ---
    ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: str  # required — no default; absence triggers ValidationError

    @field_validator("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN")
    @classmethod
    def token_must_not_be_empty(cls, v: str) -> str:
        """Reject empty or whitespace-only tokens at configuration time."""
        if not v.strip():
            raise ValueError("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN must not be empty or whitespace")
        return v

    @field_validator("LOG_LEVEL")
    @classmethod
    def log_level_must_be_known(cls, v: str) -> str:
        level = v.strip().upper()
        if level not in logging.getLevelNamesMapping():
            raise ValueError(f"LOG_LEVEL must be a logging level name, got {v!r}")
        return level

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }
