# Memory Profiling Tools

This directory contains tooling for the server-side memory-leak investigation of GROWI.
See [design.md](../../.kiro/specs/memory-leak-investigation/design.md) for the overall approach.

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

## Environment variables

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

## Policy: Do Not Commit Heap Snapshots

**Heap snapshot files (`.heapsnapshot`) MUST NOT be committed to the repository.**

- Heap snapshots are typically 50–500 MB in size
- They may contain sensitive runtime data (user data, session tokens, etc.)

The `.gitignore` rules exclude `*.heapsnapshot` files.

Record findings in `.kiro/specs/memory-leak-investigation/verification-report.md`
rather than committing raw artifacts.
