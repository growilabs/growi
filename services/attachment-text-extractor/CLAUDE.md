# attachment-text-extractor — Claude Instructions

Python 3.12 / FastAPI microservice that extracts text from binary attachments (PDF, DOCX, XLSX, PPTX, MSG, …) and returns Markdown for GROWI's full-text search index.

This file is the source of truth for AI agents working **inside `services/attachment-text-extractor/`**. The repo-root `AGENTS.md` covers Node packages; do not apply its `pnpm`/`turbo` instructions here.

## Quick Reference

This service lives **outside the pnpm workspace**. Use `uv` and `poe` — never `pnpm` or `npm`.

```bash
# Install dependencies (creates .venv/)
uv sync

# Task runner — defined in pyproject.toml under [tool.poe.tasks]
uv run poe dev              # uvicorn dev server on :8000 (auto-reload)
uv run poe test             # pytest
uv run poe lint             # ruff check .
uv run poe format           # ruff format . (auto-fix)
uv run poe format-check     # ruff format --check . (CI-friendly)
uv run poe export-openapi   # writes packages/attachment-text-extractor-client/openapi.json
uv run poe check            # lint + format-check + test (use before commit)

# Single test file (pytest auto-matches partial names)
uv run pytest tests/test_extract_router.py
uv run pytest -k "test_unauthorized"
```

## Import Convention

`src/` is on `PYTHONPATH`, so imports inside the service are always `from app.<module>`, never `from src.app.<module>`.

Tests live under `tests/` (Python convention, not co-located with source).

## Architectural Pillars

These are intentional design decisions; do not regress without explicit discussion.

### 1. Fail-fast configuration

All runtime configuration is loaded via `Settings()` (Pydantic `BaseSettings`) at process startup. `ATTACHMENT_EXTRACTOR_SERVICE_TOKEN` has no default and rejects empty/whitespace values — the process refuses to start if it is absent. Never add a development fallback or "skip auth" flag.

### 2. Bearer auth before any work

`BearerAuthMiddleware` runs before the request body is read, using constant-time comparison (`hmac.compare_digest`). Only health probe and OpenAPI schema paths bypass auth. Do not add new bypass paths without strong justification — unauthenticated paths can be used to fingerprint the service or trigger resource exhaustion via large uploads.

### 3. XXE hardening on boot

`apply_xxe_hardening()` must be called once at startup, before any XML is parsed. DOCX / XLSX / PPTX / EPUB are XML-in-ZIP and can carry crafted DTDs that trigger external-entity resolution (network egress) or billion-laughs DoS.

### 4. Resource limits enforced post-read

File size is checked against the **actual accumulated body bytes**, not `Content-Length`. A spoofed header must not bypass the size cap. Concurrency is enforced with a non-blocking semaphore — when exhausted, callers receive 503 immediately rather than queuing. Never change these to blocking or header-based checks.

### 5. MIME whitelist via registry

The format whitelist and conversion pipeline are being rebuilt (see `.kiro/specs/attachment-search-text-extractor/`). `POST /extract` takes a slot, checks the size, then calls `ConversionRunner.run()` (read from `app.state.runner`) and maps the outcome via `app/routers/extract_errors.py`; the router never calls a conversion library. The app lifespan (`create_app`) creates the runner from Settings, awaits `runner.start()` before serving and stops it in a thread on shutdown; a forkserver that cannot start boots not-ready (`/readyz` 503, `/healthz` ok) instead of aborting. `/readyz` re-verifies through `runner.verify` whenever the cached readiness is not ready, and shows only public dependency names. Tests get the real runner through the `client` fixture (TestClient as a context manager runs the lifespan); `create_app(**runner_options)` lets a test pass e.g. `probe_timeout_s`.

### 6. Dependency licensing & egress

Dependencies must be MIT/permissive-licensed and run fully offline (no network egress, no external binaries). The rationale lives in `pyproject.toml` comments.

## Coding Conventions

- **Python 3.12**: `from __future__ import annotations`, `int | None`, `StrEnum`.
- **Ruff** is linter + formatter. Config is in `pyproject.toml`. Run `uv run poe format` before committing.
- **Type hints on every public function**, including return types.
- **Module-level objects that touch `Settings()`** must be lazily initialised — constructing them at import time causes `ValidationError` during pytest collection before the autouse token fixture has run.
- **Comments in English**, even if conversation is in Japanese (repo-wide policy).

## Testing Patterns

- `tests/conftest.py` defines an **autouse** fixture that injects `ATTACHMENT_EXTRACTOR_SERVICE_TOKEN` into the environment for every test. Tests that exercise the missing-token path must `monkeypatch.delenv(...)` after this fixture has run.
- The `client` fixture **lazily imports** `app.main` and calls `pytest.skip` if it is not importable — this allows infrastructure tests to run before the app module exists.
- `asyncio_mode = "auto"` — async tests do not need `@pytest.mark.asyncio`.
- Use `httpx`-based `TestClient` (Starlette's), not `requests`.
- Binary test documents are generated in-test as session-scoped, lazy pytest fixtures in `tests/fixture_files.py` (re-exported from `tests/conftest.py`; large ones are `*_path` fixtures written under `tmp_path_factory`). Do not commit real documents. The only committed binaries are the legacy DOC / PPT files in `tests/fixtures/legacy/` (Apache POI test data; source and license in its README).

## Container Deployment

`Dockerfile` pins uv, the Python base image, `RAYON_NUM_THREADS=1`, `TMPDIR=/tmp` and `WORKERS` default 1; `infra/docker/compose.yaml` carries the recommended `MAX_CONCURRENCY=3`, `mem_limit: 2g`, read-only rootfs, uid 10001, tmpfs `/tmp`, `cap_drop: ALL` and `init: true`. `/tmp` is the only writable path at runtime (forkserver socket directory). Static checks: `tests/test_deploy_config.py`. Always run with an init (`--init` / `init: true`) so orphaned conversion children are reaped; in k8s the Pod `/tmp` emptyDir/tmpfs is discarded with the Pod.

Known follow-up: Python 3.12 cannot preload `__main__` into the forkserver, so each child re-imports the uvicorn entry script (~29ms vs ~7ms). Left as is; the overhead is negligible next to conversion time.

Container smoke test (needs docker; reusable by CI):

```bash
docker build -t attachment-text-extractor services/attachment-text-extractor
docker image inspect attachment-text-extractor --format '{{.Size}}'   # must be <= 400000000 (400MB)
docker run -d --name ate --init --read-only --user 10001:10001 --network none \
  --tmpfs /tmp:rw,size=64m,mode=1777 -e ATTACHMENT_EXTRACTOR_SERVICE_TOKEN=smoke-token \
  attachment-text-extractor
# --network none leaves no published port; run the checks inside the container's network namespace:
docker exec ate python -c "import urllib.request,sys; print(urllib.request.urlopen('http://localhost:8000/readyz').read())"
# POST /extract for a PDF and a DOCX (generate small files with pypdf / python-docx from the dev extra):
curl -s -H 'Authorization: Bearer smoke-token' -F 'file=@sample.pdf;type=application/pdf' http://<container-ip-or-published-port>:8000/extract
curl -s -H 'Authorization: Bearer smoke-token' -F 'file=@sample.docx' http://<container-ip-or-published-port>:8000/extract
```

With `--network none` there is no reachable IP, so for the curl steps either publish a port on a second run without `--network none` (egress is blocked in prod by NetworkPolicy, not needed for this check) or exec a Python client inside the container.

## Contract Export to GROWI

The OpenAPI schema is the API contract between this service and GROWI's Node code. After **any** change to schemas, routes, or error codes:

```bash
uv run poe export-openapi   # rewrites packages/attachment-text-extractor-client/openapi.json
```

Commit the updated `openapi.json` together with the service change. If you add a model returned only via `JSONResponse(content=...)` (which bypasses FastAPI's schema discovery), follow the manual-injection pattern already in `scripts/export_openapi.py`.

## Error Code Mapping

`POST /extract` failure modes map to fixed (HTTP status, `ErrorCode`) pairs. These are part of the API contract — changing them is a breaking change for `packages/attachment-text-extractor-client`.

| Condition (runner `FailureKind`) | HTTP | `ErrorCode` |
|---|---|---|
| Missing/invalid Bearer token | 401 | `unauthorized` |
| Format not supported (`unsupported`) | 400 | `unsupported_format` |
| Body exceeds `MAX_FILE_SIZE_MB` | 413 | `file_too_large` |
| Password-protected document (`encrypted`) | 422 | `file_encrypted` |
| Broken document (`malformed`) | 422 | `extraction_failed` |
| Limit hit: `limit_exceeded`, `memory_exceeded`, `result_too_large` | 422 | `resource_limit_exceeded` |
| Deadline or CPU limit hit (`timeout`) | 408 | `extraction_timeout` |
| Concurrency limit reached | 503 | `service_busy` |
| Child died without a result (`crashed`), unexpected exception (`internal`) | 500 | `extraction_failed` |

## Specs and Discovery

- Feature spec: [`.kiro/specs/attachment-search-text-extractor/`](../../.kiro/specs/attachment-search-text-extractor/) — requirements, design, and task list. Prefer reading the design doc over reverse-engineering decisions from the code.
- Consumer integration: [`.kiro/specs/attachment-search-indexing/`](../../.kiro/specs/attachment-search-indexing/)

## Before Committing

```bash
uv run poe check          # lint + format-check + test
uv run poe export-openapi # if any schema or route changed
```
