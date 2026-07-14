# Phase 3 Gate (task 3.8) — execution status

Branch: `claude/practical-volta-rrv5c8` (on `support/esm` after PR #11303 merge).
Captured in the Claude Code **cloud sandbox**, which has **no MongoDB, no
Elasticsearch, no Chromium**, and **different hardware** from the Phase 0.4/0.5
baselines.

Connectivity probe (this sandbox):

```
mongo:27017          ENOTFOUND
127.0.0.1:27017      ECONNREFUSED
localhost:27017      ECONNREFUSED
elasticsearch:9200   ENOTFOUND
```

Task 3.8 mandates that **every** sub-gate run against the **production build
output on a real MongoDB** (3.8.d also needs Chromium; 3.8.e needs the same
host as the Phase 0.4/0.5 baselines). Therefore **3.8.b–3.8.e cannot be
executed in this sandbox** and must run in the devcontainer (or CI). Per the
spec's 迂回禁止 / Evidence-capture clauses, they remain **NOT DONE** — this file
records only what was genuinely verifiable here, plus a ready-to-run handoff.

## What was verified in the sandbox

### 3.8.a basic quality gate — env-independent portions ✅
- `turbo run build --filter @growi/app` → **21/21 success** (`3.8a-build-alone.txt`)
- `turbo run lint --filter @growi/app` → **21/21 success** (`3.8a-lint-alone.txt`)
- `lint:no-cjs` (import/no-commonjs equivalent on `src/server`) → **OK, 350 files** (`3.8a-nocjs-unit.txt`)
- `vitest --project=app-unit` → **1951 passed / 8 skipped**; the single failing
  file (`update-activity.spec.ts`) is the known mongodb-memory-server 403
  download failure, a sandbox-only artifact — **green in CI**.
- The `test` (integration) portion needs mongo+ES; it is **green on the merged
  commit** via `ci-app-test` + `ci-app-test-integration` (PR #11303 run
  `27462718877`, all jobs success).

> Note: `turbo run build lint` **combined** in one invocation intermittently
> fails locally with `TS2307: Cannot find module '@growi/logger'` — a turbo
> task-orchestration race where `lint`'s dependency `dev` tasks rebuild a
> dependency's `dist/` while `@growi/app:build` is reading it. Running them
> **separately** (as CI does, in distinct jobs) is green. This is an
> environmental orchestration artifact, not a code defect.

### 3.8.c / 3.8.d capture-script ESM pre-flight ✅ (de-risks the devcontainer run)
The three baseline/capture scripts were re-wired from ts-node to **tsx** in task
3.7.b and had not been run since. Confirmed each **loads under tsx and reaches
the mongo-connect point** (fails only with `MongooseServerSelectionError`), i.e.
**no script-level ESM defect** — they are ready to run where mongo exists
(`3.8cd-gatescript-esm-preflight.txt`).

## What MUST run in the devcontainer (mongo + ES + Chromium) — NOT DONE

Run from `apps/app/` against the **production build** unless noted.

| Gate | Command(s) | Pass criterion |
|---|---|---|
| 3.8.b prod smoke | `pnpm run build` → assemble → `pnpm run server:ci`; then `node --import dotenv-flow/config.js dist/server/app.js` | exit 0; `/_api/v3/healthcheck`=200; 2 apiv3 endpoints expected status; SSR 200 of a page exercising drawio/LSX/footnote/math/mermaid/attachment-refs |
| 3.8.c authz | `pnpm run snapshot-routes` then diff vs `route-middleware-baseline.json` (middleware names match, 0 anonymous); `pnpm run authz-matrix:verify` vs `authz-matrix-baseline.json` (all apiv3 × 4 persona statuses match) | zero diff |
| 3.8.d WS | `curl -i -H 'Connection: Upgrade' -H 'Upgrade: websocket' .../socket.io/` → 101 or auth-4xx; Yjs 2-client Chromium sync < 2s; `pnpm run ws-authz-matrix:verify` vs `ws-authz-baseline.json` | zero diff; attach-before-listen log order |
| 3.8.e perf | prod start wall time ×3 (median within ±20% of Phase 0.4); OTel p95 of 5 routes within ±25%; `pnpm dev` cold start ×3 (median within ±20% of Phase 0.5) | within gates; **must be the same host as the 0.4/0.5 baselines** |

Evidence for each must be committed under this directory per the 3.8
Evidence-capture clause.

## Recommended path
1. **3.8.b** can also be obtained on real infra by dispatching the production CI
   (`reusable-app-prod.yml` / `test-prod-node24`: build-prod → `server:ci` →
   check-next-symlinks → launch-prod + Playwright). This covers prod server:ci
   smoke and part of E2E without a local devcontainer.
2. **3.8.c / 3.8.d / 3.8.e** run in the devcontainer (the scripts are
   pre-flighted ESM-ready above). 3.8.e specifically must use the Phase 0.4/0.5
   baseline host for valid timing comparison.
