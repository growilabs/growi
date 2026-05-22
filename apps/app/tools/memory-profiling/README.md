# Memory Profiling Tools

This directory contains tooling for the server-side memory-leak investigation of GROWI.
See [design.md](../../../../.kiro/specs/memory-leak-investigation/design.md) for the overall approach.

## Quick-start: after-fixes run

```bash
cd apps/app

# 1. Build the production server
pnpm run build

# 2. Start with CDP inspector and profiling enabled
NODE_ENV=development \
MEMORY_PROFILING_ENABLED=true \
MEMORY_PROFILING_OUTPUT_DIR=tmp/memory-leak-investigation/runs/after \
  node --inspect=9229 -r dotenv-flow/config dist/server/app.js &

# Wait for "GROWI is ready" in logs (~30 s), then:

# 3. Run the scenario (shortened idle for CI; use default 300 s for full investigation)
BASELINE_IDLE_SECONDS=60 DRAIN_IDLE_SECONDS=60 \
  pnpm run ts-node tools/memory-profiling/run-scenario.ts \
    --baseUrl http://localhost:3000 \
    --inspector http://127.0.0.1:9229 \
    --outputDir tmp/memory-leak-investigation/runs/after

# 4. Stop the server
kill %1
```

## Before/after comparison (for verifying fix impact)

### Step A — "before" build (fixes 2.1-2.4 and 4.1 not applied)

The simplest approach is to create a temporary worktree at commit `5f37b69fbe`
(task 1.2 — profiling infrastructure only) and cherry-pick the scenario-tool commits
(3.1-3.4 + 4.2) onto it without the fix commits (2.1-2.4, 4.1).

Alternatively, check out the commit that contains only the infrastructure:

```bash
# From repo root
git worktree add /tmp/growi-before 5f37b69fbe

cd /tmp/growi-before/apps/app
pnpm run build

NODE_ENV=development \
MEMORY_PROFILING_ENABLED=true \
MEMORY_PROFILING_OUTPUT_DIR=/tmp/growi-before/apps/app/tmp/runs/before \
  node --inspect=9229 -r dotenv-flow/config dist/server/app.js &

# Wait for ready, then run scenario from the main workspace (tools are there):
cd /workspace/growi/apps/app
BASELINE_IDLE_SECONDS=60 DRAIN_IDLE_SECONDS=60 \
  pnpm run ts-node tools/memory-profiling/run-scenario.ts \
    --baseUrl http://localhost:3000 \
    --inspector http://127.0.0.1:9229 \
    --outputDir /tmp/growi-before/apps/app/tmp/runs/before

kill %1

cp -r /tmp/growi-before/apps/app/tmp/runs/before \
       tmp/memory-leak-investigation/runs/before

git worktree remove /tmp/growi-before --force
```

### Step B — "after" build (current HEAD, all fixes applied)

Follow the quick-start section above, pointing `--outputDir` at `runs/after`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MEMORY_PROFILING_ENABLED` | (unset) | Set to `true` to enable SIGUSR2 heap snapshot handler |
| `MEMORY_PROFILING_OUTPUT_DIR` | `tmp/memory-leak-investigation/snapshots/` | Directory for heap snapshots |
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
tmp/memory-leak-investigation/
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
└── snapshots/                  # ad-hoc SIGUSR2-triggered snapshots
```

## Policy: Do Not Commit Heap Snapshots

**Heap snapshot files (`.heapsnapshot`) MUST NOT be committed to the repository.**

Reasons:
- Heap snapshots are typically 50–500 MB in size and would bloat the repository
- They may contain sensitive runtime data (user data, session tokens, etc.)

The `.gitignore` rules exclude `*.heapsnapshot` files.

**Do not share snapshot files externally.** Heap snapshots may contain sensitive
runtime data. Treat them as confidential investigation artifacts.

**Delete snapshot files as soon as they are no longer needed.** Do not accumulate
stale snapshots in your working directory.

Record findings in `.kiro/specs/memory-leak-investigation/verification-report.md`
rather than committing raw artifacts.
