# GROWI Attachment Text Extractor (apps/attachment-text-extractor)

A Node 24 + Hono microservice that extracts the text of an attachment (PDF, Office
documents, CSV, HTML, plain text, ...) for GROWI's full-text search. It parses
untrusted files, so every conversion runs in a short-lived child process under
memory, CPU and time limits. The service is stateless and Linux-only (the child is
started through `/usr/bin/prlimit`).

- API: `POST /extract` (multipart `file`, optional `mimeType`; Bearer token),
  `GET /healthz`, `GET /readyz`, `GET /openapi.json`.
- Consumer: `apps/app` through the generated client
  `packages/attachment-text-extractor-client`.
- Operators' conditions (memory limit, read-only rootfs, probes, graceful stop,
  network): [`docker/README.md`](docker/README.md). Read it before changing a
  default, a limit or the Dockerfile.

## Commands

Run from `apps/attachment-text-extractor/`.

```bash
pnpm run lint:biome        # biome check
pnpm run lint:typecheck    # tsgo --noEmit
pnpm vitest run            # all tests (about 2 minutes)
pnpm vitest run compose.spec   # one file, by partial name
pnpm run build             # dist/ (tsc + .js extensions)
```

**Run one vitest process at a time, and never next to a build.** The vitest global
setup (`test/global-setup.ts`) deletes and rebuilds `dist/`, which the tests' real
conversion children run from; a second vitest, `pnpm run build` or
`turbo run build test` at the same time pulls `dist/` away from under them.

Several tests start real conversion children and are sensitive to load: a failure
that disappears when the file runs alone on an idle machine is usually that.

### Start it locally

```bash
pnpm run build
ATTACHMENT_EXTRACTOR_SERVICE_TOKEN=dev-token node dist/main.js   # 0.0.0.0:8000, fixed
curl -s http://127.0.0.1:8000/readyz
curl -s -H 'Authorization: Bearer dev-token' -F 'file=@sample.pdf' http://127.0.0.1:8000/extract
```

The settings (environment variables) and their defaults are listed in
`docker/README.md` and defined in `src/config/load-settings.ts`.

### After changing a route, a schema or an error code

The OpenAPI document is generated from the route definitions (`src/http/`); the
copy committed in the client package is what the client is generated from. A test
(`test/openapi/export-openapi.integ.ts`) fails while the two differ, and
`ci-app.yml` fails while the generated client differs from the committed one.

```bash
# from apps/attachment-text-extractor
pnpm run export-openapi --output ../../packages/attachment-text-extractor-client/openapi.json
# from the repository root
pnpm exec biome check --write packages/attachment-text-extractor-client/openapi.json
pnpm -F @growi/attachment-text-extractor-client gen
```

Commit `openapi.json` and `src/generated/` together with the service change, and
fix the caller in `apps/app` when a name or a type changed. Changing the request
fields, the response shape or the `ErrorCode` values is a breaking change for
`apps/app`.

### Benchmark (extraction quality)

```bash
BENCHMARK_TOKEN=dev-token pnpm run benchmark --url http://127.0.0.1:8000 --label node \
  [--es-url http://elasticsearch:9200] [--json out.json]
pnpm run benchmark:generate   # rewrites benchmark/corpus/
```

It sends `benchmark/corpus/` to a running service and prints per-format tables.

### Image check and memory

`scripts/image-check/check-image.sh all` builds the image and checks it (needs
docker; CI runs the same steps in `.github/workflows/ci-attachment-text-extractor.yml`).
The memory measurement inside the image runs only when that workflow is started by
hand. Do that after upgrading anydoc, PDFium or the Node base image, or after
changing memory-related code:

```bash
gh workflow run ci-attachment-text-extractor.yml --ref <branch>
```

## Layout

```
src/
├── main.ts, service.ts   # process entry (port, signals) / composition (settings → runner → app)
├── http/                 # Hono app: auth, upload, concurrency slots, error table, OpenAPI
├── runner/               # parent side: starts, limits, watches and reaps conversion children
├── child/                # child side: entry, result framing, parent watch
├── conversion/           # the converters (anydoc, PDFium, OOXML, text); child only
├── wire/                 # parent-child protocol (length-prefixed JSON, guards)
├── formats/              # format table, per-format input size limits
├── contract/             # types shared by all layers (ErrorCode, PageInfo, limits)
└── config/               # settings, log levels
scripts/                  # OpenAPI export and drift check, image check, memory measurement
test/                     # deploy-file checks, black-box HTTP tests, layer check, fixtures
benchmark/                # corpus, scoring, report
docker/                   # Dockerfile, README for operators
```

Tests are co-located (`*.spec.ts` unit, `*.integ.ts` with real processes or sockets);
cross-cutting ones live in `test/`.

### Layer rule

The HTTP parent must never load conversion code, and the child must never load the
parent's code: `runner` and `http` may not import `conversion` or `child`;
`conversion` and `child` may not import `runner` or `http`; `contract`, `formats`
and `wire` are leaves shared by both sides. `zod` and `hono-openapi` belong to
`http` alone. `test/layers/layer-dependencies.spec.ts` enforces this from
`test/layers/layer-rules.ts`; change the rules only with a design reason.

## Invariants

- **The token never reaches a child or a log.** A child gets an explicit
  environment (`src/runner/child-env.ts`), never `process.env`. Start-up errors name
  the setting at fault, not its value.
- **No file content or file name in logs or error messages.** The request log line
  carries format, size, duration, result and child peak RSS only.
- **The child is untrusted.** It parses hostile input, so the parent validates
  everything a child sends (`src/wire/`, `src/runner/result-frame.ts`) and enforces
  the limits from outside (prlimit, the RSS watch, the deadline). Do not move a
  check into the child alone.
- **The memory budget.** One container is one Node process plus at most
  `MAX_CONCURRENCY` children, within the 2 Gi limit explained in
  `docker/README.md`. An upload is held in memory and never written to disk. A
  change to a default, to what the parent buffers, or to a conversion library needs
  the memory measurement above.
- **Bearer auth runs before the body is read**; only `/healthz`, `/readyz` and
  `/openapi.json` are open. `/healthz` stays 200 when conversion is broken;
  `/readyz` turns 503.
- **(status, `ErrorCode`) pairs are part of the contract.** They come from
  `src/http/error-table.ts` (`ERROR_TABLE`, `REFUSAL_TABLE`), which also feeds the
  OpenAPI document.
- **Dependencies** are permissively licensed, run offline and are pinned where the
  output depends on them (`@firecrawl/anydoc`, `@embedpdf/pdfium`, `htmlparser2`).
  `test/deploy/production-dependencies.spec.ts` lists the production ones.

## Specs

Design rationale: `.kiro/specs/attachment-search-text-extractor/` (feature) and
`.kiro/specs/attachment-search-indexing/` (the consumer in `apps/app`).
