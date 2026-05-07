"""Application configuration loaded from environment variables.

Uses pydantic-settings so that every setting can be overridden via the
environment or a `.env` file.  MARKITDOWN_SERVICE_TOKEN has no default and
must be provided; the service will fail to start (fail-fast) if it is absent
or contains only whitespace.
"""

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Runtime configuration for the markitdown-extractor service.

    All fields are read from environment variables (case-insensitive).
    A `.env` file in the working directory is also supported.

    Required:
        MARKITDOWN_SERVICE_TOKEN: Bearer token used to authenticate incoming
            POST /extract requests.  Must be non-empty.  Leaving it unset or
            supplying an empty/whitespace value raises ``ValidationError`` at
            startup — this is intentional fail-fast behaviour (Req 3.3).

    Optional (with defaults):
        MAX_FILE_SIZE_MB (int, default 50): Upper limit on the size of an
            uploaded file.  Requests that exceed this limit are rejected with
            HTTP 413 (Req 2.1).
        TIMEOUT_S (int, default 60): Maximum seconds allowed for a single
            extraction task before it is cancelled (Req 2.2).
        MAX_CONCURRENCY (int, default 4): Maximum number of extractions that
            may run simultaneously.  Set to ``max(2, workers * 2)`` in the
            deployment environment (Req 2.3).  The default of 4 is a safe
            conservative value for a two-worker deployment.
        MAX_EXTRACTED_BYTES (int, default 524288000): Maximum bytes of
            extracted Markdown to keep per file.  Acts as a zip-bomb guard.
            Default is 500 MiB.
        LOG_LEVEL (str, default "INFO"): Python ``logging`` level name.
    """

    # --- Limits (Reqs 2.1, 2.2, 2.3) ---
    MAX_FILE_SIZE_MB: int = 50
    TIMEOUT_S: int = 60
    MAX_CONCURRENCY: int = 4  # static default; set via env for production deployments
    MAX_EXTRACTED_BYTES: int = 500 * 1024 * 1024  # 500 MiB zip-bomb guard

    # --- Observability ---
    LOG_LEVEL: str = "INFO"

    # --- Security (Req 3.3) ---
    MARKITDOWN_SERVICE_TOKEN: str  # required — no default; absence triggers ValidationError

    @field_validator("MARKITDOWN_SERVICE_TOKEN")
    @classmethod
    def token_must_not_be_empty(cls, v: str) -> str:
        """Reject empty or whitespace-only tokens at configuration time."""
        if not v.strip():
            raise ValueError("MARKITDOWN_SERVICE_TOKEN must not be empty or whitespace")
        return v

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }
