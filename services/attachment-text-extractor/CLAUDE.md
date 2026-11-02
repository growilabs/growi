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

### 4. Resource limits enforced on the bytes that arrive

The concurrency slot is taken **before** the body is read (non-blocking semaphore: when exhausted, callers receive 503 at once, without the body being received). The body is then read by the router itself (`app/routers/extract_upload.py`, not FastAPI `File` / `Form` parameters, which would read and spool the whole body before the handler runs): it is held in memory only (never spooled to TMPDIR, a small tmpfs), capped while it streams in at `MAX_FILE_SIZE_MB` + a 64 KiB multipart allowance (413), and must arrive within `UPLOAD_TIMEOUT_S` (408). An oversized `Content-Length` is rejected early, but the size is always checked against the **actual received bytes** — a spoofed header must not bypass the cap. `Limits` is built once in the lifespan and read from `app.state.limits`. Never change these to blocking or header-only checks.

### 5. MIME whitelist via registry

The format whitelist and conversion pipeline are being rebuilt (see `.kiro/specs/attachment-search-text-extractor/`). `POST /extract` takes a slot, checks the size, then calls `ConversionRunner.run()` (read from `app.state.runner`) and maps the outcome via `app/routers/extract_errors.py`; the router never calls a conversion library. While the run is in flight the router watches for the client disconnecting and cancels the run if it does (the runner kills and reaps the child on cancellation, before the slot is released). The app lifespan (`create_app`) creates the runner from Settings, removes `ATTACHMENT_EXTRACTOR_SERVICE_TOKEN` from `os.environ` (the forkserver and every conversion child would otherwise inherit it; Settings keeps the value, so nothing may re-read `Settings()` after startup), awaits `runner.start()` before serving and stops it in a thread on shutdown; a forkserver that cannot start boots not-ready (`/readyz` 503, `/healthz` ok) instead of aborting. `/readyz` re-verifies through `runner.verify` whenever the cached readiness is not ready, and shows only public dependency names. Tests get the real runner through the `client` fixture (TestClient as a context manager runs the lifespan); `create_app(**runner_options)` lets a test pass e.g. `probe_timeout_s`.

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

Logging: `create_app` attaches one stderr handler to the `app` logger at `LOG_LEVEL` (uvicorn configures only its own loggers); each request writes one `extract format=… size=… duration_ms=… result=… child_peak_rss_mb=…` line without the file name, content or token.

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

## Known Limits

- **CSV / TSV over `MAX_CSV_BYTES` (8 MiB) and HTML over `MAX_HTML_BYTES` (20 MiB) are refused before any conversion child starts** (422 `resource_limit_exceeded`, log `result=limit_exceeded`). `ConversionRunner.run()` checks this in the parent with `app.conversion.limits.check_input_size` (the format is resolved as the child would), and `conversion.core.convert` checks it again. The cap counts input bytes only, so it is an early, cheap refusal and NOT a promise that a smaller file fits. anydoc's memory follows the number of CELLS, not the bytes: about one million cells go over `MAX_CHILD_RSS_MB` (320). Measured child peaks: a CSV of one-character cells (`a\n`) already exceeds the limit at 2 MiB (362 MB); `abc,def,ghi` rows exceed it at 4–8 MiB (336–353 MB); ordinary rows (dates, numbers, names) of 7 MiB (about 780k cells) pass. A file over the cell count is still stopped by the RSS limit (422 `resource_limit_exceeded`, log `memory_exceeded`), so a dense numeric CSV of 2–4 MiB can be refused. Three such 8 MiB uploads at once peaked at about 1.1 GB for the whole process tree (limit 2g / 2Gi); one child reached 405 MB before it was stopped.
- **HTML with pathological tags or attributes** (thousands of attributes in one tag, `<a/////…>`) can make the stdlib `html.parser` use several hundred MB from only 4 MB of input, far below `MAX_HTML_BYTES`. The size cap cannot catch these; the RSS limit is what stops them (422 `resource_limit_exceeded`), so it must stay. Ordinary HTML of 20 MiB peaks at about 245 MB.
- **A caller that disconnects mid-conversion** has its conversion cancelled at once: the child is killed and reaped within milliseconds, the slot is released and the log line says `result=client_disconnected` (`app/routers/client_disconnect.py`). It watches the ASGI `receive()` for `http.disconnect`; `Request.is_disconnected()` does not work through the `BaseHTTPMiddleware` layers. A client that half-closes its socket (`shutdown(SHUT_WR)`) after sending the request also counts as gone; this uvicorn (httptools) never delivered a response to such a client before either, so only the immediate stop is new. Two requests pipelined on one connection followed by a disconnect only cancel the newest one (uvicorn marks the disconnect on the latest request only); the first runs to completion, as it did before this change. Node's undici does not pipeline by default.
- **Caller timeout vs `TIMEOUT_S`**: the conversion deadline starts only after the body has been received (which itself may take up to `UPLOAD_TIMEOUT_S`), and stopping and reaping a child adds up to ~4s. A caller should therefore use a timeout of at least `TIMEOUT_S` + ~10s plus its upload time. The default `TIMEOUT_S` 55 against the Node caller's 60s default is an open decision owned by the user; do not change the default here.
- **Multipart part headers are capped at about 4 KiB** by python-multipart, so a file name longer than that is answered with 422 `extraction_failed`.
- **`/tmp/pymp-*` after SIGTERM**: uvicorn re-raises SIGTERM after a clean shutdown, so Python's exit hooks (where multiprocessing removes its `pymp-*` socket directory) do not run and an empty directory remains. In containers `/tmp` is a tmpfs / emptyDir discarded with the container, so it never accumulates there.

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
| Body exceeds `MAX_FILE_SIZE_MB` (declared or received) | 413 | `file_too_large` |
| Body not received within `UPLOAD_TIMEOUT_S` | 408 | `extraction_timeout` |
| Not a multipart form with one `file` part (missing, plain field, broken framing) | 422 | `extraction_failed` |
| Password-protected document (`encrypted`) | 422 | `file_encrypted` |
| Broken document (`malformed`) | 422 | `extraction_failed` |
| Limit hit: `limit_exceeded` (incl. `MAX_CSV_BYTES` / `MAX_HTML_BYTES`, checked before a child starts), `memory_exceeded`, `result_too_large` | 422 | `resource_limit_exceeded` |
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
