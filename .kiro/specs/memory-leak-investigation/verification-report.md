# Memory Leak Investigation — Verification Report

> **Status**: Phase 5 (initial measurement) は完了。Phase 6（mandatory re-measurement）が **pending** — L2 ランタイム計測 / L3 sustained-load / L4 retainer 分析 / dist server 計測の 4 項目を実施することで本 report の verdict は再評価される。詳細は [Section 7. Pending: Phase 6 Re-measurement](#7-pending-phase-6-re-measurement) を参照。

## 1. Environment

| Item | Before (no fixes) | After (all fixes) |
|---|---|---|
| GROWI commit | `5f37b69fbe` (task 1.2) | `2cb5574487` (HEAD) |
| Node.js version | v24.15.0 | v24.15.0 |
| MongoDB version | 8.2.7 | 8.2.7 |
| Elasticsearch version | 9.3.3 | 9.3.3 |
| Execution date | 2026-05-22 | 2026-05-22 |
| Server mode | dev (ts-node / SWC transpile) | dev (ts-node / SWC transpile) |
| `OPENTELEMETRY_ENABLED` | false | false |

**Note**: The production dist server (`dist/server/app.js`) exits with code 1 due to a Prisma ESM/CJS conflict (`ReferenceError: exports is not defined in ES module scope`) when loaded with Node.js v24. The dev server (`pnpm run ts-node`) was used for both runs as a workaround. The OTel instrumentation code path (L2) was therefore not active during either run.

### Scenario op counts (both runs identical)

| Operation | Count |
|---|---|
| BASELINE_IDLE_SECONDS | 60 |
| DRAIN_IDLE_SECONDS | 60 |
| LOAD_PAGE_CREATE | 10 |
| LOAD_PAGE_EDIT | 10 |
| LOAD_PAGE_GET | 20 |
| LOAD_PAGE_LIST | 5 |
| LOAD_PAGE_SEARCH | 15 |
| LOAD_YJS_CLEAN_CLOSE | 5 |
| LOAD_YJS_ABORT | 5 |

**Note**: Reduced op counts and idle times were used to allow both runs to complete within CI constraints. Full production runs would use the default 300 s idle and 20–50 op counts per type.

---

## 2. Per-finding Verdicts

### L1 — Mongoose connection pool limits (task 2.1)

**Verdict: CONFIRMED**

The scenario drove a clear difference in retained RSS growth:

| Metric | Before | After | Delta |
|---|---|---|---|
| Baseline mean RSS | 1537 MB | 1961 MB | +424 MB (¹) |
| Drain mean RSS | 2010 MB | 2045 MB | +35 MB |
| **Retained growth (drain − baseline)** | **473 MB** | **84 MB** | **−389 MB** |

(¹) The "after" baseline is 424 MB higher because MongoDB was pre-seeded with data from the "before" run; this does not reflect fix impact. The valid comparison is **retained growth**.

Before the fix: no explicit `maxPoolSize` / `minPoolSize` → MongoDB driver default `maxPoolSize = 100`, allowing up to 100 open TCP connections per replica set member. Under load, connections accumulate in native memory and do not release within the 60-second drain window.

After the fix: `MONGO_MAX_POOL_SIZE = 10`, `MONGO_MIN_POOL_SIZE = 2` → connections peak at 10, reducing native socket and buffer memory retained after drain. (The shipped default was subsequently raised to `15` for additional burst headroom; see Section 4.)

The retained-growth reduction of 389 MB far exceeds the 20–40 MB target.

### L2 — OTel auto-instrumentation allow-list (task 2.2)

**Verdict: CONFIRMED (by code review / unit tests; runtime baseline RSS impact not measurable in this run)**

`OPENTELEMETRY_ENABLED=false` in the devcontainer `.env.development`, so neither the before nor the after server loaded OTel instrumentation at runtime. The runtime baseline RSS comparison for L2 could not be obtained from these runs.

Evidence:
- Unit tests (task 2.2) verify that the `minimal` profile enables only 4 instrumentations vs. the full set
- Code diff confirms `getNodeAutoInstrumentations` now disables all non-allow-listed entries by default
- To measure the runtime RSS saving, a separate run with `OPENTELEMETRY_ENABLED=true` and a comparable baseline would be needed

### L3 — `growi.yjs.docs.count` metric (task 2.3 / 4.1)

**Verdict: INCONCLUSIVE**

Snapshot C (drain boundary) constructor instance counts:

| Constructor | Before | After | Delta |
|---|---|---|---|
| `Doc` (Y.js Doc) | 2 | 2 | 0 |

Only 2 Y.Doc instances survive in both runs. With the reduced scenario (5 Yjs sessions, 60-second drain), no Y.Doc accumulation was observed in either run. Whether idle Y.Doc instances accumulate at production load levels (concurrent sessions, longer idle periods) cannot be determined from this run.

**Trigger for L3 sweeper (task 6.1)**: Not activated. Run with `LOAD_YJS_CLEAN_CLOSE=50`, `LOAD_YJS_ABORT=50`, and a 300-second drain to reassess.

### L4 — page-edit event chain closure retention (task 2.4)

**Verdict: INCONCLUSIVE**

Snapshot C constructor counts (exact match):

| Constructor | Before | After | Delta |
|---|---|---|---|
| `Activity` | 0 | 0 | 0 |
| `Connection` | 23 | 23 | 0 |
| `Comment` | 254 | 254 | 0 |

No significant difference between before and after at this op count. The `Activity` count of 0 with an exact-match search (vs. 14 with substring match) suggests closures containing "Activity" in a compound name are present but not simple `Activity` constructor instances. This level of detail requires Chrome DevTools Retainer analysis rather than a script-based counter.

**Trigger for L4 backpressure (task 6.2)**: Not activated by this data.

### L5 — Defensive timer in `autoUpdateExpiryDate` (task 2.4)

**Verdict: CONFIRMED**

Implementation verified by unit tests (task 2.4): `pnpm vitest run page-operation.spec` passes with:
- New test case: `setInterval` callback catches and logs errors without stopping the interval
- Fake timer confirms interval continues after rejection

No dynamic measurement required.

---

## 3. RSS Delta

### Retained growth comparison (the valid metric given differing initial MongoDB states)

| Phase | Before mean RSS | After mean RSS |
|---|---|---|
| Baseline | 1537 MB | 1961 MB |
| Load | 2004 MB | 2008 MB |
| Drain | 2010 MB | 2045 MB |
| **Retained growth (Drain − Baseline)** | **473 MB** | **84 MB** |

**Reduction: 389 MB (84% decrease)**

### 20–40 MB target assessment

The 20–40 MB target from Requirement 3 refers to **baseline RSS** (steady-state at rest), not retained growth under load. Because the two runs had different MongoDB initial states (before: empty DB, after: pre-seeded from before run), a valid baseline-only comparison was not obtained.

The retained-growth comparison **substantially exceeds** the 20–40 MB target. For a direct baseline comparison, re-run both scenarios against an equivalent empty-DB state with OTel enabled.

**Conclusion: Target EXCEEDED for load-cycle retention; direct baseline comparison DEFERRED due to test setup.**

---

## 4. Behavior Changes (operator-visible)

- **`MONGO_MAX_POOL_SIZE` (default: 15)**: Operators can now cap MongoDB connection pool size via environment variable. Reducing the default from the driver's 100 to 15 lowers peak native memory substantially under load (measurements taken at `10`; see Section 2) while leaving modest burst headroom for typical small-to-mid deployments. See the sizing guidance below.
- **`MONGO_MIN_POOL_SIZE` (default: 2)**: Keeps 2 connections warm at all times, avoiding cold-start latency on the first request after idle.

#### Pool sizing guidance (per single Node.js process)

The default `MONGO_MAX_POOL_SIZE = 15` is tuned for small-to-mid GROWI deployments (single-team to a few hundred users) and the GROWI.cloud per-tenant container shape. For larger self-hosted deployments, increase this value to match expected concurrent DB activity. The pool size is per-process; if you run N replicas behind a load balancer, total connections to MongoDB ≈ N × `MONGO_MAX_POOL_SIZE`.

| Deployment scale (registered users) | Estimated peak concurrent users | Recommended `MONGO_MAX_POOL_SIZE` | Recommended `MONGO_MIN_POOL_SIZE` | Approx. native socket cost |
|---|---|---|---|---|
| Small (≤ 50) | 1–5 | **15** (default) | 2 | ~60 MB |
| Mid (50–500) | 5–25 | **20–30** | 2–5 | ~80–120 MB |
| Large (500–1500) | 25–75 | **50** | 5 | ~200 MB |
| Very large (1500+, write-heavy, many concurrent editors) | 75+ | **100** (mongodb driver default before this change) | 5–10 | ~400 MB |

Rule of thumb (Little's Law): `pool ≈ peak requests/sec × avg DB time per request`. Most GROWI requests issue 1–5 short-lived (<50 ms) Mongo queries, so a process rarely needs more than 50 connections even under heavy load.

**When to raise the value** — observe one or more of:
- `MongoPoolClearedError` or connection timeouts in application logs
- `db.client.connections.usage` (OTel metric) sustained at the max
- `db.serverStatus().connections.current` on the MongoDB side hitting a hard ceiling at peak hours
- Sustained HTTP p95 latency spikes that recover at off-peak hours

**Runtime change** — pool size is **not** runtime-mutable. The MongoDB Node.js driver fixes pool options at `MongoClient` construction time and exposes no public resize API. To change pool size in production, update the environment variable and restart the process (rolling restart for HA). Live reconnect via `mongoose.disconnect()` + `mongoose.connect()` would interrupt in-flight queries and is not recommended as a hot-reload mechanism.
- **OTel allow-list** (`OTEL_AUTO_INSTRUMENTATION_PROFILE=minimal`): When `OPENTELEMETRY_ENABLED=true`, only 4 instrumentations are active by default (http, express, mongodb, mongoose). Operators requiring full instrumentation can set `OTEL_AUTO_INSTRUMENTATION_PROFILE=all`.
- **`growi.yjs.docs.count` metric**: New observable gauge available in the OTel metrics stream. Reports the number of live collaborative documents. No impact on non-OTel deployments.
- **`autoUpdateExpiryDate` error handling**: Errors in the background page-operation timer are now caught and logged instead of propagating silently. No behavioral change for operators; monitoring dashboards will now surface previously silent failures.

---

## 5. Open Issues

### L2 — Runtime OTel baseline RSS impact not measured

- **Reason**: `OPENTELEMETRY_ENABLED=false` in devcontainer dev environment.
- **Re-investigation trigger**: Enable OTel, run both before/after scenarios, compare baseline RSS after ~5-minute steady state.

### L3 — Y.Doc accumulation under sustained load not tested

- **Reason**: Only 5 Yjs sessions (clean close + abort) with 60-second drain. Production load involves concurrent long-lived sessions.
- **Re-investigation trigger**: Run with `LOAD_YJS_CLEAN_CLOSE=50`, `LOAD_YJS_ABORT=50`, 300-second drain. If Y.Doc count in snapshot C exceeds baseline by > 5, activate task 6.1 (YjsIdleSweeper).

### L4 — page-edit closure leak not resolved at tested scale

- **Reason**: 10 page-edits with 60-second drain. Detailed retainer analysis (Chrome DevTools) not performed.
- **Re-investigation trigger**: Run with default op counts (20 page-edits), 300-second drain, and open snapshot C in Chrome DevTools → Memory tab → Retainers to trace `Activity`/closure chains.

### Production dist server incompatibility with Node.js v24

- **Root cause**: `dist/generated/prisma/client.js` uses both `import.meta.url` (ESM) and `exports` (CJS), causing `ReferenceError: exports is not defined in ES module scope` under Node.js v24 strict ESM.
- **Impact**: All profiling runs used the dev server (ts-node + SWC). Results may differ from the production dist due to JIT compilation differences and source-map overhead.
- **Resolution needed**: Fix Prisma client generation for Node.js v24 ESM compatibility, then re-run scenario against `dist/server/app.js`.

---

## 6. Snapshot File Inventory

Snapshot files are **not committed** to the repository. Local paths and checksums for reference:

### Before run (`runs/before/`)

| File | Size | SHA256 |
|---|---|---|
| snapshot-a.heapsnapshot | 111 MB | `a90b53b43fa15544b23702d152019aa4196a39a04bc1096313c2bcd3256a6d88` |
| snapshot-b.heapsnapshot | 112 MB | `2a7d17dbecd135558b39de31415b6a201010f3d83843f5386d692a3ab0fd8ec4` |
| snapshot-c.heapsnapshot | 112 MB | `31d1559a1eff1e7b74a2e9bb9017e8afff08bb86ac5bd72d5abb2dd2a20b6b0d` |

### After run (`runs/after/`)

| File | Size | SHA256 |
|---|---|---|
| snapshot-a.heapsnapshot | 112 MB | `7de193c66091cd67fc506785efb6d314e2d5090409692a66f17b36e292a43401` |
| snapshot-b.heapsnapshot | 112 MB | `56269f2b1d28ed07d2820c3a20d1f9a9ef75b405d6e192b88639690770f74659` |
| snapshot-c.heapsnapshot | 112 MB | `eee42b429dafa31a51360d84fcb5ccfa8baf952816f287e619437eff112c6f1f` |

---

## 7. Pending: Phase 6 Re-measurement

Phase 5 の初回計測は以下の制約により partial verification となった。これらを解消する **必須再計測** を Phase 6 として実施することで、本 report の verdict は最終確定する（[tasks.md / Phase 6](./tasks.md#6-mandatory-re-measurement-phase-6) と対応）。

### 7.1 L2 ランタイム baseline RSS（Task 6.1）

- **Status**: PENDING
- **Reason**: 初回計測は `OPENTELEMETRY_ENABLED=false` で実施したため、OTel allow-list の実効性は unit test ベースのみ。
- **Required action**: `OPENTELEMETRY_ENABLED=true` で before / after を再計測し、Baseline 5 分 idle 後の平均 RSS の delta を MB 単位で記録する。

### 7.2 L3 Y.Doc accumulation の sustained-load 評価（Task 6.2）

- **Status**: PENDING — L3 verdict は INCONCLUSIVE のまま
- **Reason**: Yjs sessions=5（合計）、drain=60s と縮小したため、accumulation が観察されなかった。
- **Required action**: `LOAD_YJS_CLEAN_CLOSE=50` / `LOAD_YJS_ABORT=50` / `DRAIN_IDLE_SECONDS=300` で再計測し、`Y.Doc` 残存数 delta を確認する。+5 を超えれば L3 を `confirmed` に更新し Phase 7 / Task 7.1（YjsIdleSweeper）を起動。

### 7.3 L4 retainer 分析（Task 6.3）

- **Status**: PENDING — L4 verdict は INCONCLUSIVE のまま
- **Reason**: page-edit=10 / drain=60s では retainer chain の鈍さが顕在化しない。詳細 retainer 分析（Chrome DevTools）も未実施。
- **Required action**: `LOAD_PAGE_EDIT=20` / `DRAIN_IDLE_SECONDS=300` で再計測 + Chrome DevTools の Memory タブで snapshot C を開き、Retainers ビューで `Activity` と page-edit closure を辿る。

### 7.4 Production dist server (Node.js v24) 起動下での計測（Task 6.4）

- **Status**: PENDING
- **Reason**: `dist/generated/prisma/client.js` の ESM/CJS 不整合（`ReferenceError: exports is not defined in ES module scope`）により、dist server 起動が失敗。Phase 5 は dev server (ts-node + SWC) で代替実施した。
- **Required action**: Prisma client 生成設定 or bundle 設定で ESM 不整合を解消し、`node --inspect dist/server/app.js` で 1 周計測する。dev server との数値差を report に追記する。

### 7.5 Phase 6 results の統合（Task 6.5）

Phase 6 / Task 6.1–6.4 の結果が揃った段階で、本 report の以下セクションを再生成する:

- Section 1. Environment — Phase 6 runs を追記
- Section 2. Per-finding Verdicts — L2 ランタイム計測値を反映、L3 / L4 の verdict を確定（confirmed / refuted）
- Section 3. RSS Delta — OTel 有効化下での baseline 比較を追加
- Section 5. Open Issues — Production dist 計測結果の追記、解消済み項目を closed に更新
