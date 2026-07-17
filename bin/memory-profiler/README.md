# Memory Profiling Tools

This directory contains tooling for server-side memory profiling of GROWI.
See [design.md](../../.kiro/specs/memory-profiler/design.md) for the tool's architecture and stable contract.

> For a lightweight startup-focused comparison instead (boot RSS + loaded-module
> diff between two production builds), see [`../startup-memory-ab/`](../startup-memory-ab/README.md).
> This directory hosts the full baseline → load → drain scenario tooling.

## Stable Contract

This section defines the **stable public surface** of the memory-profiler tool.
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

`bin/memory-profiler/index.ts` re-exports exactly the following five symbols, in this order:

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
import { runScenario, ScenarioRunnerError } from '@growi/bin/memory-profiler';
import type { ScenarioRunnerOptions, LoadOpCounts, LoadDriver } from '@growi/bin/memory-profiler';
```

Deep paths such as `@growi/bin/memory-profiler/load-driver` or `@growi/bin/memory-profiler/lib/...` are **blocked by the `exports` field** in `bin/package.json` and must not be used.

## Change Review Process

- **Breaking change definition.** Any change to a symbol or value listed in [Stable Contract](#stable-contract) — including renames, deletions, type-shape changes, exit-code reassignment, CSV header changes, and output filename changes — is treated as a **breaking change**.
- **Required for breaking changes.** A breaking change MUST come with:
  - An update to this spec (`.kiro/specs/memory-profiler/`) reflecting the new contract.
  - An impact assessment for any downstream investigation specs that consume this tool.
  - Explicit change-review approval before merging.
- **Internal changes.** Changes that do not touch the Stable Contract — refactors inside `lib/`, additional internal scenarios, adjustments to the `CdpSnapshotClient` / `RssTimeSeriesLogger` internal interfaces, factory-function signatures, etc. — follow the normal PR review process and do not require spec updates.

## Running the scenario

All commands below are run from `apps/app` so that the dev server picks up the
correct `dotenv-flow` configuration. The scenario runner itself uses only
relative `.ts` imports, so it runs directly on Node.js native type stripping —
no ts-node / tsconfig-paths involved (both were removed in the ESM migration).

### Quick-start: after-fixes run

```bash
cd apps/app

# 1. Start the dev server with CDP inspector
NODE_ENV=development pnpm run tsrun --inspect=0.0.0.0:9229 src/server/app.ts &

# Wait for "GROWI is ready" in logs (~20 s), then:

# 2. Run the scenario (shortened idle for CI; use default 300 s for full investigation)
BASELINE_IDLE_SECONDS=60 DRAIN_IDLE_SECONDS=60 \
  node ../../bin/memory-profiler/run-scenario.ts \
    --baseUrl http://localhost:3000 \
    --inspector http://127.0.0.1:9229 \
    --outputDir tmp/memory-profiler/runs/after

# 3. Stop the server
kill %1
```

To profile the production build instead (as the memory-leak-investigation
Phase 6 runs did), start `node --inspect=127.0.0.1:9229 dist/server/app.js`
with `NODE_ENV=production` and the target `MONGO_URI`, then run step 2
unchanged. Note the load driver calls the installer endpoint, so the target
DB must be a FRESH (not yet installed) GROWI database.

### Before/after comparison

To compare two builds (e.g., a fix branch vs. its base), run the scenario twice
with different `--outputDir` values — typically `runs/before/` and `runs/after/`
under `tmp/memory-profiler/`. Switch between builds with the usual git workflow
(checkout, stash, revert) in between runs. Any consumer spec that needs a
reproducible before/after comparison should document its own checkout steps.

## Output layout

```
apps/app/tmp/memory-profiler/
├── runs/
│   ├── before/                 # one profiling run (name is consumer-defined)
│   │   ├── snapshot-a.heapsnapshot   (baseline boundary)
│   │   ├── snapshot-b.heapsnapshot   (load boundary)
│   │   ├── snapshot-c.heapsnapshot   (drain boundary)
│   │   └── rss-timeseries.csv
│   └── after/                  # another profiling run
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
the appropriate investigation spec (e.g. its `verification-report.md`) rather than
committing raw `.heapsnapshot` / `.csv` outputs.
