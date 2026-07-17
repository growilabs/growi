# Startup Memory A/B Tools

Lightweight tooling to compare the **boot-time memory footprint and loaded-module
set** of two GROWI production builds (e.g. two branches, or before/after a
lazy-loading change). Complements [`../memory-profiler/`](../memory-profiler/README.md),
which covers the full baseline → load → drain scenario with heap snapshots; use
THIS directory when the question is "what does the server load and cost at
startup", not "how does memory behave under load".

These tools were used for the v7.5 vs v8.0 startup comparison (2026-07) that
cleared the ESM-migration suspicion and attributed the regression to Prisma
runtime residency + zod v4, and for verifying the lazy-loading PRs
(#11479 / #11480 / #11481).

Linux-only (reads `/proc/<pid>/status`); designed for the devcontainer.

## Files

| File | Role |
|---|---|
| `measure.sh` | Orchestrates one measurement run against a production build |
| `module-log.mjs` | `--import` hook: logs every loaded module (CJS **and** ESM) via Node 24 `module.registerHooks` |
| `cdp-mem.mjs` | One-shot `process.memoryUsage()` fetch over the CDP inspector |
| `analyze-modules.mjs` | Diffs two module-load logs by package (pnpm-store-path aware) |
| `import-cost.mjs` | RSS delta of importing a single package in isolation |

## Measuring one build

```bash
# 1. Build the branch first
turbo run build --filter @growi/app

# 2. Run the measurement (~3.5 min):
#    boots the server against a FRESH database, waits for HTTP ready,
#    idles 30 s, creates an admin via POST /_api/v3/installer, issues one
#    SSR request, idles 90 s, then shuts down.
bash bin/startup-memory-ab/measure.sh \
  <label> <appdir> <db-name> <port> <inspect-port> <outdir> \
  --import ./bin/runtime/env-preload.mjs     # loader flags for THIS build's era
#  -r dotenv-flow/config                     # (v7.5-era CJS builds instead)
```

The named database is **dropped** at the start of every run — always use a
dedicated name (e.g. `growi_memab_xyz`), never a real one. The `pages`
collection is pre-created after the drop because v7.5-era builds abort boot on
a fully empty database (`ns does not exist: <db>.pages` during TTL-index setup).

Outputs in `<outdir>`: `rss.csv` (2 s samples: `epoch,phase,VmRSS-kB`),
`mem-ready-idle.json` / `mem-installed-idle.json` (heapUsed/heapTotal/external
via CDP), `modules.txt` (sorted unique loaded-module URLs), `server.log`.

## Comparing two runs

```bash
node bin/startup-memory-ab/analyze-modules.mjs \
  runA/modules.txt runB/modules.txt labelA labelB
```

Reports packages loaded only on one side, large per-package file-count deltas,
and the top packages by file count — this is what attributes an RSS gap to
concrete dependencies.

## Per-package import cost

```bash
# Copy into the target app dir first: bare specifiers resolve relative to the
# SCRIPT's location, not the cwd.
cp bin/startup-memory-ab/import-cost.mjs apps/app/tmp/
cd apps/app && node --expose-gc tmp/import-cost.mjs <package-name>
```

For transitive (non-direct) dependencies, pass the resolved `file://` URL of
the package's entry instead of a bare specifier.

## Pitfalls (learned the hard way)

- **Comparability**: run measurements **sequentially**, same machine, same
  Node. `measure.sh` pins the relevant env (`MONGO_URI`, empty
  `ELASTICSEARCH_URI`, `FILE_UPLOAD=mongodb`, `OPENTELEMETRY_ENABLED=false`)
  precisely so that a stray `.env.production.local` cannot skew one side.
- **No heap cap**: runs have no `V8_MAX_HEAP_SIZE`, so transient boot peaks
  read higher than production (where GC is pressured earlier). Compare peaks
  between runs, not against production limits directly.
- **Numbers to watch**: the *installed-idle* stable RSS (steady state) and the
  *boot-phase max* (the transient peak — what OOM-kills a tight-limit pod at
  startup).
- Do not run `pnpm install` anywhere while a measurement/build is in flight
  (see the devcontainer rule on pnpm concurrency).
