# Memory Profiling Tools

This directory contains tooling for the server-side memory-leak investigation of GROWI.
See [design.md](../../.kiro/specs/memory-leak-investigation/design.md) for the overall approach.

## Stable Contract

This section defines the **stable public surface** of the memory-profiling tool.
Any change to a symbol listed here is a **breaking change** (see [Change Review Process](#change-review-process) below).

### CLI arguments

`run-scenario.ts` accepts the following CLI arguments:

| Argument | Required | Type | Description |
|---|---|---|---|
| `--baseUrl` | yes | string | Base URL of the running GROWI server (e.g. `http://localhost:3000`) used by the load driver to issue HTTP requests. |
| `--inspector` | yes | string | CDP inspector endpoint of the target Node process (e.g. `http://127.0.0.1:9229`) used to take heap snapshots. |
| `--outputDir` | yes | string | Output directory for `snapshot-a/b/c.heapsnapshot` and `rss-timeseries.csv`. Created if missing. |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `BASELINE_IDLE_SECONDS` | `300` | Baseline idle duration (seconds) |
| `DRAIN_IDLE_SECONDS` | `300` | Drain idle duration (seconds) |
| `LOAD_PAGE_CREATE` | `20` | Page creates in load phase |
| `LOAD_PAGE_EDIT` | `20` | Page edits in load phase |
| `LOAD_PAGE_GET` | `50` | Page reads in load phase |
| `LOAD_PAGE_LIST` | `10` | Page list calls in load phase |
| `LOAD_PAGE_SEARCH` | `30` | Page searches in load phase |
| `LOAD_YJS_CLEAN_CLOSE` | `10` | Yjs sessions with clean close |
| `LOAD_YJS_ABORT` | `10` | Yjs sessions with TCP-RST abort |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — all three snapshots and `rss-timeseries.csv` were written. |
| `1` | Snapshot acquisition failure — `HeapProfiler.takeHeapSnapshot` or chunk assembly failed. |
| `2` | CDP connection failure — the inspector endpoint could not be reached or the CDP session could not be established. |

### Output file naming

All four files are written directly under the directory specified by `--outputDir`:

- `snapshot-a.heapsnapshot` — heap snapshot at the **baseline boundary** (end of baseline idle phase).
- `snapshot-b.heapsnapshot` — heap snapshot at the **load boundary** (end of load phase).
- `snapshot-c.heapsnapshot` — heap snapshot at the **drain boundary** (end of drain idle phase).
- `rss-timeseries.csv` — process RSS / heap time-series sampled throughout the run.

The CSV header is fixed:

```csv
timestamp,phase,rss,heap_used,heap_total,external
```

### TypeScript public API (top-level barrel)

`bin/memory-profiling/index.ts` re-exports exactly the following five symbols, in this order:

| # | Symbol | Kind | Description |
|---|---|---|---|
| 1 | `LoadDriver` | type | Driver contract for the load phase (mockable for tests). |
| 2 | `LoadOpCounts` | type | Per-operation counts (page create/edit/get/list/search, yjs clean/abort) for the load phase. |
| 3 | `ScenarioRunnerOptions` | type | Options object accepted by `runScenario`. |
| 4 | `runScenario` | function | Entry point that drives the full baseline → load → drain scenario. |
| 5 | `ScenarioRunnerError` | class | Error class thrown for scenario failures (carries an exit-code-aligned `code`). |

Internal symbols (factory functions, `lib/*` helpers, per-scenario `run*` functions, `LOAD_*` env-default constants, the `CdpSnapshotClient` and `RssTimeSeriesLogger` interfaces, etc.) are intentionally **not** re-exported.

### Package import path

Consumers must import only from the top-level barrel:

```ts
import { runScenario, ScenarioRunnerError } from '@growi/bin/memory-profiling';
import type { ScenarioRunnerOptions, LoadOpCounts, LoadDriver } from '@growi/bin/memory-profiling';
```

Deep paths such as `@growi/bin/memory-profiling/load-driver` or `@growi/bin/memory-profiling/lib/...` are **blocked by the `exports` field** in `bin/package.json` and must not be used.

## Change Review Process

- **Breaking change definition.** Any change to a symbol or value listed in [Stable Contract](#stable-contract) — including renames, deletions, type-shape changes, exit-code reassignment, CSV header changes, and output filename changes — is treated as a **breaking change**.
- **Required for breaking changes.** A breaking change MUST come with:
  - An update to this spec (`.kiro/specs/memory-profiler/`) reflecting the new contract.
  - An impact assessment for downstream consumers (currently `.kiro/specs/memory-leak-investigation/`, plus any future consumer).
  - Explicit change-review approval before merging.
- **Internal changes.** Changes that do not touch the Stable Contract — refactors inside `lib/`, additional internal scenarios, adjustments to the `CdpSnapshotClient` / `RssTimeSeriesLogger` internal interfaces, factory-function signatures, etc. — follow the normal PR review process and do not require spec updates.

## Running the scenario

All commands below are run from `apps/app` so that `pnpm run ts-node` picks up
the correct `tsconfig-paths` and `dotenv-flow` configuration.

### Quick-start: after-fixes run

```bash
cd apps/app

# 1. Start the dev server with CDP inspector
NODE_ENV=development pnpm run ts-node --inspect=0.0.0.0:9229 src/server/app.ts &

# Wait for "GROWI is ready" in logs (~20 s), then:

# 2. Run the scenario (shortened idle for CI; use default 300 s for full investigation)
BASELINE_IDLE_SECONDS=60 DRAIN_IDLE_SECONDS=60 \
  pnpm run ts-node ../../bin/memory-profiling/run-scenario.ts \
    --baseUrl http://localhost:3000 \
    --inspector http://127.0.0.1:9229 \
    --outputDir tmp/memory-leak-investigation/runs/after

# 3. Stop the server
kill %1
```

### Before/after comparison (for verifying fix impact)

#### Step A — "before" run (fixes not applied)

Temporarily revert the fix commits in-place, start the server, run the scenario,
then restore HEAD:

```bash
cd apps/app

# Revert fix files to pre-fix state
git checkout 5f37b69fbe -- \
  src/server/util/mongoose-utils.ts \
  src/features/opentelemetry/server/node-sdk-configuration.ts \
  src/features/opentelemetry/server/custom-metrics/index.ts \
  src/server/service/page-operation.ts
git rm --cached src/features/opentelemetry/server/custom-metrics/yjs-metrics.ts
rm -f src/features/opentelemetry/server/custom-metrics/yjs-metrics.ts

# Start server with the reverted code
NODE_ENV=development pnpm run ts-node --inspect=0.0.0.0:9229 src/server/app.ts &

# Run scenario
BASELINE_IDLE_SECONDS=60 DRAIN_IDLE_SECONDS=60 \
  pnpm run ts-node ../../bin/memory-profiling/run-scenario.ts \
    --baseUrl http://localhost:3000 \
    --inspector http://127.0.0.1:9229 \
    --outputDir tmp/memory-leak-investigation/runs/before

kill %1

# Restore HEAD
git checkout HEAD -- \
  src/server/util/mongoose-utils.ts \
  src/features/opentelemetry/server/node-sdk-configuration.ts \
  src/features/opentelemetry/server/custom-metrics/index.ts \
  src/server/service/page-operation.ts \
  src/features/opentelemetry/server/custom-metrics/yjs-metrics.ts
```

#### Step B — "after" run (current HEAD, all fixes applied)

Follow the quick-start section above, pointing `--outputDir` at `runs/after`.

## Output layout

```
apps/app/tmp/memory-leak-investigation/
├── runs/
│   ├── before/                 # pre-fix profiling run
│   │   ├── snapshot-a.heapsnapshot   (baseline boundary)
│   │   ├── snapshot-b.heapsnapshot   (load boundary)
│   │   ├── snapshot-c.heapsnapshot   (drain boundary)
│   │   └── rss-timeseries.csv
│   └── after/                  # post-fix profiling run
│       ├── snapshot-a.heapsnapshot
│       ├── snapshot-b.heapsnapshot
│       ├── snapshot-c.heapsnapshot
│       └── rss-timeseries.csv
```

## Output Storage Policy

**Heap snapshot files (`*.heapsnapshot`) MUST NOT be committed to the repository.**

- Heap snapshots are typically 50–500 MB in size.
- They may contain sensitive runtime data — user content, session tokens, admin credentials, in-memory secrets.
- The `.gitignore` already excludes `*.heapsnapshot` files; do not add exceptions.

**Do not share snapshots externally** without explicit review. This includes cloud storage,
chat tools, issue trackers, and any third-party service. Treat snapshot files as
confidential production-equivalent data.

**Clean up locally** when an investigation is complete. Remove `*.heapsnapshot` files
from your local working tree once findings have been recorded.

**Record findings, not artifacts.** Write conclusions, retainer analysis, and graphs into
`.kiro/specs/memory-leak-investigation/verification-report.md` (or the appropriate spec)
rather than committing raw `.heapsnapshot` / `.csv` outputs.
