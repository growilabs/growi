# Memory Profiling Tools

This directory contains tools and scripts for profiling memory usage in the GROWI application.

## Startup Procedure

To start GROWI in profiling mode, set the following environment variables before starting the development server:

```bash
# Enable memory profiling
MEMORY_PROFILING_ENABLED=true \
MEMORY_PROFILING_OUTPUT_DIR=tmp/memory-leak-investigation \
pnpm run dev
```

### Triggering a Heap Snapshot

Once the server is running with profiling enabled, you can trigger a heap snapshot via the signal handler:

```bash
# Send SIGUSR2 to the Node.js process to take a heap snapshot
kill -USR2 <PID>

# Or use the helper script (if available):
# node tools/memory-profiling/trigger-snapshot.js
```

The process PID can be found with:

```bash
pgrep -f "node.*growi"
```

## Output Location

All profiling artifacts are written to:

```
tmp/memory-leak-investigation/
├── snapshots/          # Heap snapshot files (*.heapsnapshot)
└── rss-timeseries.csv  # RSS memory time-series log (if enabled)
```

The default output directory is `tmp/memory-leak-investigation/`, controlled by the `MEMORY_PROFILING_OUTPUT_DIR` environment variable.

## Policy: Do Not Commit Heap Snapshots

**Heap snapshot files (`.heapsnapshot`) MUST NOT be committed to the repository.**

Reasons:
- Heap snapshots are typically 50–500 MB in size and would bloat the repository
- They may contain sensitive runtime data (user data, session tokens, etc.)
- They are not useful as version-controlled artifacts

The `.gitignore` rules in this repository exclude `*.heapsnapshot` files.

**Do not share snapshot files externally.** Heap snapshots may contain sensitive runtime data including user-generated content, session tokens, or internal application state. Treat them as confidential investigation artifacts.

**Delete snapshot files as soon as they are no longer needed for investigation.** Do not accumulate stale snapshots in your working directory.

**What to commit instead:**
- Aggregated metrics (RSS values, allocation counts)
- Summary tables and observations written in investigation reports
- Scripts and tooling (this directory)

Investigation findings should be recorded in `.kiro/specs/memory-leak-investigation/` as human-readable Markdown files.
