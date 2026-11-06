# ---------------------------------------------------------------------------
# Builder stage: install Python dependencies via uv into an isolated .venv
# ---------------------------------------------------------------------------
FROM python:3.12.15-slim-bookworm AS builder

# Pinned exactly so that rebuilds resolve the same installer (the lockfile
# pins the dependencies, not uv itself). Bump deliberately together with CI.
COPY --from=ghcr.io/astral-sh/uv:0.12.24 /uv /usr/local/bin/uv

# Compile bytecode at build time: the runtime rootfs is read-only and
# PYTHONDONTWRITEBYTECODE is set, so nothing could be cached on first import.
# Copy (not hardlink) so the .venv can be moved to the runtime stage as is.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Dependency manifests only, so application code changes keep this layer cached.
COPY pyproject.toml uv.lock .python-version ./

# `dev` is an optional extra, so it is never installed unless --extra dev is
# passed; test-only libraries (openpyxl, pypdf, ...) stay out of the image.
# --locked: never re-resolve. --no-install-project: src/ is copied below.
RUN uv sync --locked --no-install-project

# ---------------------------------------------------------------------------
# Runtime stage: minimal image with only the pre-built .venv + app source
# ---------------------------------------------------------------------------
FROM python:3.12.15-slim-bookworm AS runtime

# Dedicated non-root user; no home dir keeps it compatible with a read-only rootfs.
RUN groupadd --gid 10001 appgroup && \
    useradd --uid 10001 --gid appgroup --shell /bin/sh --no-create-home appuser

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY src/ ./src/

# Precompile the app for the same reason as the builder (read-only rootfs).
RUN python -m compileall -q src

# PYTHONPATH exposes src/ without an editable install (--no-install-project).
# RAYON_NUM_THREADS must be set before the forkserver starts: anydoc's thread
# pool otherwise spawns one thread per core and virtual memory peaks at ~1.2GB.
# TMPDIR: the forkserver creates its UNIX socket directory under it, so it must
# be a short, writable path (a tmpfs on a read-only rootfs).
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RAYON_NUM_THREADS=1 \
    TMPDIR=/tmp

USER 10001

EXPOSE 8000

# sh -c evaluates ${WORKERS:-1} at start time; exec makes uvicorn PID 1 so
# SIGTERM reaches it directly. Memory sizing assumes one worker (see compose).
# Run with an init (`docker run --init`, compose `init: true`) so orphaned
# conversion children are reaped if a forkserver dies; uvicorn does not reap them.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WORKERS:-1}"]
