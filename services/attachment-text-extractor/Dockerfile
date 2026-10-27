# ---------------------------------------------------------------------------
# Builder stage: install Python dependencies via uv into an isolated .venv
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS builder

# Install uv from the official image (Apache-2.0)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy only the files uv needs to resolve and install dependencies.
# Source code is intentionally excluded here so that changes to application
# code do not invalidate the dependency cache layer.
COPY pyproject.toml uv.lock .python-version ./

# Install production dependencies (no dev extras) into .venv.
# --locked  : enforce the lockfile — never re-resolve
# --no-dev  : skip dev-only dependency groups (pytest, httpx, ruff)
# --no-install-project : skip editable-install of the project itself;
#             we copy src/ manually so the layer stays cache-friendly
RUN uv sync --locked --no-dev --no-install-project

# ---------------------------------------------------------------------------
# Runtime stage: minimal image with only the pre-built .venv + app source
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

# Create a dedicated non-root user and group (uid/gid 10001).
# --no-create-home avoids writing to /home, compatible with read-only rootfs.
RUN groupadd --gid 10001 appgroup && \
    useradd --uid 10001 --gid appgroup --shell /bin/sh --no-create-home appuser

WORKDIR /app

# Copy the virtual environment produced by the builder.
# Only .venv is copied — no uv binary, no source cache.
COPY --from=builder /app/.venv /app/.venv

# Copy application source code.
# src/app/ contains the FastAPI application package.
COPY src/ ./src/

# Prepend the venv's bin directory so the runtime Python and all installed
# scripts (uvicorn, etc.) are found without activating the venv explicitly.
# PYTHONPATH: expose src/ so that `import app` resolves to src/app/ without
# an editable install (the project is not installed as a package in .venv
# because --no-install-project is used in the builder stage).
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    # Suppress .pyc bytecode generation (not useful in containers)
    PYTHONDONTWRITEBYTECODE=1 \
    # Ensure stdout/stderr are unbuffered so structured logs stream immediately
    PYTHONUNBUFFERED=1

# Drop to non-root before any EXPOSE or CMD directives.
USER 10001

# Document the service port; actual binding is controlled by CMD.
EXPOSE 8000

# Use sh -c so that ${WORKERS:-2} shell parameter expansion is evaluated at
# container start time rather than image build time. ENTRYPOINT is
# intentionally omitted; CMD alone avoids ambiguity when overriding in k8s.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WORKERS:-2}"]
