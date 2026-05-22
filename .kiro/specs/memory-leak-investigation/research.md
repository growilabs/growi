# GROWI Server-Side Memory Leak Investigation

**Branch**: `claude/investigate-growi-memory-leaks-09kl4`
**Date**: 2026-05-21
**Scope**: server-side (Node.js) memory characterization for GROWI.cloud per-tenant containers running the official GROWI Docker image
**Method**: static code analysis (dynamic profiling was prevented by the sandbox's outbound network policy blocking MongoDB 4.2+ binary distribution endpoints — see Appendix A)

---

## TL;DR

The ~200MB baseline per `apps/app` container is **dominated by composition cost, not leaks**. We found:

- **2 likely leak surfaces** that can compound under load over hours/days
- **3 baseline-bloat surfaces** that inflate steady-state RSS without leaking
- **0 confirmed unbounded growth bugs** in server code we read

The top wins for GROWI.cloud node-pool density are the **baseline-bloat** fixes (low-risk, immediate), not chasing leaks.

---

## Findings, ordered by impact

### L1 — Mongoose default connection pool of 100 (baseline bloat, immediate fix)

`apps/app/src/server/util/mongoose-utils.ts:50`
```ts
export const mongoOptions: ConnectOptions & ConnectionOptionsExtend = {
  useUnifiedTopology: true,
};
```
`apps/app/src/server/crowi/index.ts:352`
```ts
return mongoose.connect(mongoUri, mongoOptions);
```

`maxPoolSize` is not set, so Mongoose/MongoDB driver defaults to **100 connections** per app instance. For a low-traffic per-tenant GROWI.cloud container, ~95 of those sockets sit idle and still hold per-connection buffers (~10–50 KB each) plus heap-side bookkeeping.

**Estimated baseline savings**: 5–15 MB per container with `maxPoolSize: 10`.

**Fix** (low risk):
```ts
export const mongoOptions = {
  useUnifiedTopology: true,
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE ?? 10),
  minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE ?? 2),
};
```

---

### L2 — OpenTelemetry auto-instrumentations turn on everything by default (baseline bloat)

`apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts:52`
```ts
instrumentations: [
  getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-pino': { enabled: false },
    '@opentelemetry/instrumentation-fs':   { enabled: false },
    '@opentelemetry/instrumentation-http': { enabled: true, ... },
  }),
],
```

`getNodeAutoInstrumentations()` enables **30+ instrumentations** (express, mongoose, mongodb, http, dns, net, undici, koa, fastify, redis, …). Each wraps the original module with a tracing proxy. For modules GROWI doesn't even import, the wrapper layer still ships and resolves on require.

Combined with the default `BatchSpanProcessor` (queue up to **2048 spans**) plus a 5-min `PeriodicExportingMetricReader`, the SDK steady-state is +20–40 MB.

**Additional risk** if `https://telemetry.growi.org` becomes unreachable from a tenant container: spans queue to 2048 then drop. Not a leak, but a measurable bump in RSS until exports succeed.

**Fix**: enumerate the instrumentations GROWI actually needs (likely just `http`, `express`, `mongodb`/`mongoose`) and disable the rest. Or expose an env-driven allow-list.

---

### L3 — y-websocket `docs` Map can retain Y.Docs across leaked WebSocket sessions (leak surface)

`apps/app/src/server/service/yjs/yjs.ts:7`
```ts
import { docs, setPersistence, setupWSConnection } from 'y-websocket/bin/utils';
```

`y-websocket`'s `setupWSConnection(...)` registers a `Y.Doc` in its module-level `docs` Map keyed by `pageId`, and only removes it when **the last** WebSocket connection on that doc closes AND `persistence.writeState` resolves. Each `Y.Doc` carries the full CRDT history (tens of KB to several MB depending on edit history).

Failure modes that retain a doc indefinitely:
1. A client TCP connection that half-closes (NAT timeout, ALB idle close, mobile sleep) without a clean WS close frame — y-websocket's `closeConn` won't run promptly.
2. `writeState` (which calls `mdb.flushDocument(pageId)`) hangs or throws and the cleanup chain doesn't complete.
3. Long awareness sessions on dashboards/preview tabs that nobody explicitly closes.

`apps/app/src/server/service/yjs/create-mongodb-persistence.ts:61–93` adds two more listeners on each `ydoc` (`update`, `awareness.update`) inside `bindState`. These die with the doc, but they hold closures over `mdb`, `io`, `docName`, and a `lastEmittedSize` counter, so retained docs retain those too.

**How to measure**: take a heap snapshot at idle, generate 100 edit sessions, force-close them all, then snapshot again. `Y.Doc` instance count should return to baseline. If it doesn't, that's the leak.

**Mitigations** to consider:
- Add an idle-timeout sweeper that calls `closeConn` on sockets with no awareness updates for N minutes.
- Add a periodic `docs.size` gauge to OpenTelemetry custom metrics (see `apps/app/src/features/opentelemetry/server/custom-metrics/system-metrics.ts` for the existing pattern — adding `yjs.docs.count` there is ~10 LoC).
- Ensure `httpServer.on('upgrade', …)` (yjs.ts:71) destroys the socket on every error path; the current code already does this in `catch`, but it would be worth confirming via Sentry/log scan whether `Yjs upgrade handler failed unexpectedly` ever logs in production.

---

### L4 — Page-edit event fan-out keeps closures alive across long async chains (leak surface, modest)

`apps/app/src/server/service/activity.ts:48` registers an `'update'` listener that internally re-emits `'updated'`, which is consumed by `InAppNotificationService` (`in-app-notification.ts:48`). Each `'updated'` handler awaits `createInAppNotification` → `generateSnapshot` → DB writes → `emitSocketIo`.

Each page edit therefore holds references to:
- the full `activity` document
- the full `page`/`target` document
- a `preNotify` closure that captures `getAdditionalTargetUsers`
- the user list returned by `preNotify`

…until the entire async chain resolves. With 8 search listeners (`apps/app/src/server/service/search.ts:164–229`) firing in parallel on the same event, a slow Elasticsearch response will pin all of the above in the heap.

This isn't an unbounded leak — eventually it drains. But on a tenant with bursty edits and a slow ES (or no ES, just timing out), the high-water mark scales with edit rate × handler latency.

**Mitigation**: nothing structural needs to change, but it's worth pinning per-event handler latency in metrics, and adding a backpressure cap on concurrent in-flight handlers per emitter.

---

### L5 — `PageOperationService.autoUpdateExpiryDate` setInterval cleanup is correct, but fragile (informational)

`apps/app/src/server/service/page-operation.ts:236`
```ts
autoUpdateExpiryDate(operationId: ObjectIdLike): NodeJS.Timeout {
  const timerObj = global.setInterval(async () => {
    await PageOperation.extendExpiryDate(operationId);
  }, AUTO_UPDATE_INTERVAL_SEC * 1000);
  return timerObj;
}
```

Used in `apps/app/src/server/service/page/index.ts:821–851` wrapped in try/finally — the timer **is** cleared on both success and failure paths.

Caveat: the interval callback is `async () => …` and any rejection inside `extendExpiryDate` is silently swallowed by `setInterval` (no `.catch`). Not a memory leak today, but a debugging blind spot — if `PageOperation.extendExpiryDate` ever throws synchronously enough to take the timer down, we'd never know.

**Suggestion** (defensive):
```ts
const timerObj = setInterval(async () => {
  try {
    await PageOperation.extendExpiryDate(operationId);
  } catch (err) {
    logger.error({ err, operationId }, 'extendExpiryDate failed');
  }
}, AUTO_UPDATE_INTERVAL_SEC * 1000);
```

---

### Patterns we checked and ruled out

| Pattern | File | Verdict |
|---|---|---|
| `SocketIoService.guestClients` Set growth | `server/service/socket-io/socket-io.ts:35` | Properly add/delete on connect/disconnect ✅ |
| `pageEvent.on(…)` re-registration on reconnect | `server/service/search.ts:278` | `reconnectClient` does NOT re-register events ✅ |
| `ConfigManager` `envConfig` / `dbConfig` Maps | `server/service/config-manager/config-manager.ts:29–35` | Bounded by static config-key set ✅ |
| Session store accumulation | `server/crowi/index.ts:399` | Sessions stored in MongoDB via `connect-mongo`, not in heap ✅ |
| Passport `deserializeUser` cache | `server/service/passport.ts:1125` | Fresh `User.findById` per request, no in-memory cache ✅ |
| pino-pretty worker in production | `packages/logger/src/transport-factory.ts:41` | `.env.production` sets `FORMAT_NODE_LOG=false` → raw JSON, no worker ✅ |
| `pending` Map in page-tree | `features/page-tree/services/page-tree-children.ts:10` | Client-side only; `pending.delete` in `finally` ✅ |
| Module-level Maps/Sets in `server/` | (grep, ~25 sites) | All are function-local or properly cleared ✅ |
| `EventEmitter` listener count | 6 emitters (`PageEvent`, `UserEvent`, `TagEvent`, `AdminEvent`, `BookmarkEvent`, `commentEvent`) | All listener registration in service constructors, fired once at boot ✅ |
| multer temp uploads | `server/routes/index.js:46`, `server/routes/apiv3/attachment.js:142` | `multer-autoreap` deletes on response close — at worst a disk leak, not heap ✅ |
| Mongoose `populate` chains | `server/service/in-app-notification.ts:147` (deepest) | Allocations are per-request and GC'd, not retained ✅ |

---

## What I'd actually do to ship a fix

In order of cost-to-benefit:

1. **Cap `maxPoolSize` to 10** (L1). One-line change, immediate per-container savings, no behavior change for a per-tenant container.
2. **Trim OpenTelemetry instrumentations** (L2) to the ones GROWI actually uses. Auditable list — `http`, `express`, `mongodb`, `mongoose`, `pg` (if any). Disable the rest.
3. **Add a `yjs.docs.count` custom metric** (L3) via the existing OTel custom-metrics file. This converts a hypothetical leak into a measurable one; we can decide on sweeper logic after we see real numbers.
4. **Wrap the `setInterval` callback in try/catch** (L5). Defensive, ~3 lines.
5. **Defer L4** until we have telemetry confirming the high-water mark is a problem.

After (1) and (2), expect baseline to drop **20–40 MB per container** without changing functionality.

---

## Appendix A — Why dynamic profiling was not performed in this session

The sandbox environment for this branch has an outbound network policy that allows:
- `registry.npmjs.org`, `github.com`, `codeload.github.com`, `raw.githubusercontent.com`
- `archive.ubuntu.com`, `security.ubuntu.com`, `download.docker.com` (apt repos)
- `pypi.org`, `files.pythonhosted.org`, `nodejs.org`

…and blocks:
- `fastdl.mongodb.org`, `downloads.mongodb.com`, `repo.mongodb.com`, `cdn.mongodb.org` (HTTP 403, `host_not_allowed`)
- Docker Hub layer storage (`*.cloudfront.net`)
- `quay.io`, `ghcr.io` for MongoDB images
- `cdn.jsdelivr.net`, `deb.nodesource.com`, `api.npms.io`

GROWI requires Mongoose 6.13.9, which talks to MongoDB ≥ 4.2 (the codebase uses aggregation-pipeline updates at runtime, e.g., the post-startup write that fails on 3.6 with `BSON field 'update.updates.u' is the wrong type 'array'`).

I built MongoDB 3.6 (the only version available in the Ubuntu apt archive) from scratch by:
- Installing the `mongodb-server-core` 3.6.9 deb with `--force-depends`
- Backfilling `libssl1.1`, `libpcre3`, `libpcrecpp0v5`, `libboost-*-1.71` from focal/jammy archive pool
- Compiling `yaml-cpp 0.6.2` from source with `-D_GLIBCXX_USE_CXX11_ABI=1` to match the C++11 ABI symbol mangling Mongo 3.6 expects

The resulting binary runs (`db version v3.6.8` confirmed) but GROWI's server immediately fails post-startup with the aggregation-pipeline error.

Production build of `apps/app` succeeded (`.next` 102 MB, `dist` 31 MB) and is still on disk, so as soon as a MongoDB 4.2+ endpoint is reachable from this environment the dynamic phase can resume without any rebuild. The intended flow was:

1. Start `node --inspect=0.0.0.0:9229 -r dotenv-flow/config dist/server/app.js`
2. Drive `/api/v3/installer/` to create an admin user
3. Speak CDP from a sidecar Node script (`ws` is in `node_modules`) to issue `HeapProfiler.takeHeapSnapshot` at baseline / mid / end
4. Drive page render + page edit endpoints for a few hundred iterations
5. Diff snapshots for retained constructor counts

If you can make MongoDB 4.2+ reachable (a staging MONGO_URI, or an ECR Public mirror that the network policy permits, or a private registry with a PAT), drop it into `apps/app/.env` and the dynamic verification can finish in ~30 minutes.

---

## Appendix B — Files inspected

```
apps/app/src/server/crowi/index.ts            (Crowi singleton, db connect, session store)
apps/app/src/server/app.ts                    (entry point, process listeners)
apps/app/src/server/util/mongoose-utils.ts    (mongoOptions, getMongoUri)
apps/app/src/server/service/activity.ts       (activityEvent listener)
apps/app/src/server/service/in-app-notification.ts
apps/app/src/server/service/search.ts         (pageEvent/bookmark/tag/comment listeners, reconnect logic)
apps/app/src/server/service/passport.ts       (deserializeUser)
apps/app/src/server/service/config-manager/config-manager.ts
apps/app/src/server/service/socket-io/socket-io.ts
apps/app/src/server/service/yjs/yjs.ts
apps/app/src/server/service/yjs/create-mongodb-persistence.ts
apps/app/src/server/service/page-operation.ts (setInterval site)
apps/app/src/server/service/page/index.ts     (timer caller, listener registration)
apps/app/src/server/events/{page,user,activity,bookmark,tag,admin}.ts
apps/app/src/features/comment/server/events/event-emitter.ts
apps/app/src/features/opentelemetry/server/node-sdk.ts
apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts
apps/app/src/features/opentelemetry/server/custom-metrics/system-metrics.ts
apps/app/src/pages/[[...path]]/server-side-props.ts
apps/app/src/server/middlewares/auto-reconnect-to-search.js
apps/app/src/server/service/search-reconnect-context/reconnect-context.js
apps/app/src/server/routes/apiv3/installer.ts
apps/app/src/server/routes/apiv3/page/create-page.ts
packages/logger/src/transport-factory.ts
```

---

# Part 2 — Design Phase Discovery (2026-05-22)

本セクションは design phase で実施した discovery / synthesis の成果を記録する。Part 1（上記、2026-05-21 の静的解析レポート）の各 finding L1-L5 を実装可能な設計へ落とし込むための情報を集約する。

## Summary
- **Discovery Scope**: Extension（既存 GROWI server への dynamic profiling 基盤追加 + 4 ファイルの局所修正 + custom-metrics モジュール 1 個追加）
- **Key Findings**:
  - 既存 OpenTelemetry custom-metrics 統合パス (`setupCustomMetrics()`) は dynamic import + 関数呼び出し列の形になっており、`yjs-metrics.ts` を 1 ファイル追加 + `index.ts` に 2 行追加するだけで L3 metric を組み込める（[apps/app/src/features/opentelemetry/server/custom-metrics/index.ts](../../apps/app/src/features/opentelemetry/server/custom-metrics/index.ts)）。
  - `y-websocket/bin/utils` の `docs` (Map) は import 可能で、`.size` を読むだけで Y.Doc 件数を取得できる。lock や snapshot は不要（[apps/app/src/server/service/yjs/yjs.ts:7](../../apps/app/src/server/service/yjs/yjs.ts#L7)）。
  - 既存 `node-sdk-configuration.ts` の `getNodeAutoInstrumentations(...)` 呼び出しは 1 か所のみ。allow-list 方式への置き換えは関数置換 1 か所で済む（[apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts:51-66](../../apps/app/src/features/opentelemetry/server/node-sdk-configuration.ts#L51-L66)）。
  - devcontainer の `mongo:27017` (replica set `rs0`) と `elasticsearch:9200` は常時到達可能。Part 1 で profiling を阻んだ MongoDB 4.2+ 入手不可問題は本セッションでは存在しない（参照: `.claude/rules/devcontainer.md`）。
  - 本番 build 成果物 `apps/app/dist/server/app.js` が残存しており、再ビルドなしで `--inspect` 起動可能。

## Research Log

### Extension Point Analysis — OpenTelemetry custom-metrics
- **Context**: L3 metric (`y-websocket docs count`) をどの統合点に追加するか確定する。
- **Sources Consulted**: `custom-metrics/index.ts`, `custom-metrics/system-metrics.ts`, `.kiro/specs/opentelemetry/{requirements,design}.md`
- **Findings**:
  - `setupCustomMetrics()` は 4 module（application / user-counts / page-counts / system）を dynamic import → `add*Metrics()` 呼び出しの順で合成。新規 module 追加コストは barrel への 2 行追加 + dynamic import + 関数呼び出し 1 行。
  - 既存 module は `meter.createObservableGauge(name, { description, unit })` + `addCallback` パターン。`yjs-metrics.ts` も同形式で揃える。
  - `opentelemetry` spec Out of scope: 「既存メトリクスの名称変更や再構成」。新規 metric **追加** は in-scope。
- **Implications**: `yjs-metrics.ts` を `custom-metrics/` 配下に新規追加し、`setupCustomMetrics()` のリストに加える設計が最小コスト。Metric 名は既存命名規約に従い `growi.yjs.docs.count`。

### Extension Point Analysis — y-websocket docs Map access
- **Context**: `y-websocket` の `docs` Map を安全に読み出す方法を確認する。
- **Sources Consulted**: `apps/app/src/server/service/yjs/yjs.ts:7`, `y-websocket/bin/utils.js`
- **Findings**:
  - `docs` は module-level `Map<string, WSSharedDoc>`。`setupWSConnection` 内で add/delete される。
  - `.size` 読み出しは同期 / lock-free / side-effect-free。Observable Gauge コールバック内で安全。
  - `import { docs } from 'y-websocket/bin/utils'` は既に [yjs.ts:7](../../apps/app/src/server/service/yjs/yjs.ts#L7) で行われている。
- **Implications**: L3 metric の callback は実質 1 行 (`observableResult.observe(docs.size)`)。後続の sweeper も同じ `docs` Map を iterate する。

### Build vs. Adopt — Heap snapshot 取得手段
- **Context**: heap snapshot 取得方法の選定。
- **Sources Consulted**: Node.js Inspector / `v8.writeHeapSnapshot()`、Chrome DevTools Protocol、`clinic` / `heapdump` / `heapsnapshot-parser`
- **Findings**:
  - **採用**: `--inspect` 起動 + CDP over WebSocket（外部 sidecar） / `v8.writeHeapSnapshot(path)`（in-process、SIGUSR2 起動）。両方とも Node 標準機能で追加 runtime dependency 不要。
  - **不採用**: `clinic` 系は profiling 用に node を fork する形で継続稼働モデルと噛み合わない。`heapdump` は Node 24 互換が不安定。
- **Implications**: 新規 runtime dependency なし。Sidecar 側は `ws`（既存）+ minimal CDP client。

### Build vs. Adopt — Load driver
- **Context**: 負荷生成スクリプトの選定。
- **Sources Consulted**: `autocannon`, `k6`, `undici`, 既存 `apps/app/test/integration/` パターン
- **Findings**:
  - **採用**: `undici`（Node 24 標準・既存依存）で順次 HTTP リクエスト発行する custom スクリプト。シナリオごとに request 列を別 module。
  - **不採用**: `k6`（別バイナリ）、`autocannon`（throughput-focused でシナリオ表現力が弱い）、`@playwright/test`（browser 駆動が過剰）。
  - y-websocket セッションの open/close は `ws` + minimal `Y.Doc` client で模擬。abort（half-close）は `socket.destroy()`。
- **Implications**: 新規 runtime dependency なし。スクリプトは `bin/memory-profiling/`（`@growi/bin` workspace package）に集約。
  > **Update**: 初期 design では `apps/app/tools/memory-profiling/` 配下に置く想定だったが、実装過程で workspace 分離（`bin/`）に移行した（commit `b8e3efa4c7`）。

### Integration Risk — SIGUSR2 ハンドラ（実装中に棄却）
- **Context**: GROWI server に SIGUSR2 ハンドラを追加することの安全性確認。
- **Sources Consulted**: `apps/app/src/server/app.ts`, Node.js signal docs
- **Findings**:
  - SIGUSR2 は Node の内部利用（debugger）と衝突しうる。`MEMORY_PROFILING_ENABLED=true` の場合のみハンドラ登録する形が安全。
- **Implications (revised)**: ハンドラは当初 `apps/app/src/server/util/heap-snapshot-handler.ts` に隔離する設計だったが、実装中に CDP (Chrome DevTools Protocol) クライアントが信頼できる主経路として確立したため SIGUSR2 経路は **完全に削除** した（commit `b8e3efa4c7`）。`apps/app` への signal handler 追加面と新規 env var はゼロとなった。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Inline profiling code in server | Snapshot 取得・シナリオ実行を server 内に組み込む | Single process | Production にも profiling code 混入、責務肥大 | 不採用 |
| **External sidecar (CDP-only)**（採用） | server は通常起動（`--inspect`）のみ。シナリオ実行と CDP-based snapshot 取得は別プロセス・別 workspace | 関心の分離、production への影響ゼロ（apps/app への追加面なし）、再利用容易 | 起動・接続手順がやや複雑（README で吸収） | 採用 |
| External sidecar + SIGUSR2 hook | 上記 + CDP 不可時の SIGUSR2 fallback | CDP 不可時の retreat | apps/app への signal handler 追加が必要 | 初期採用 → 実装中に削除 |
| Forked profiling binary（`clinic` 系） | 別ツールに丸投げ | 自前実装ゼロ | 実行モデル不一致、custom シナリオ表現困難 | 不採用 |

## Design Decisions

### Decision: External sidecar (CDP-only) で profiling を分離する
- **Context**: profiling 機能を server 本体にどこまで埋め込むか。
- **Alternatives Considered**:
  1. Server に常駐させて env var で gate
  2. External sidecar が CDP + SIGUSR2 を駆動し、server 側は minimal hook のみ
  3. **External sidecar が CDP のみで完結し、server 側は通常通り `--inspect` で起動するだけ**
- **Selected Approach**: 当初 2 を採用したが、実装過程で 3 に切り替えた。Sidecar / シナリオ / RSS ロガーは `bin/memory-profiling/`（`@growi/bin` workspace）、server 側は **追加面ゼロ**（CDP のみで完結）。
- **Rationale**: CDP `HeapProfiler.takeHeapSnapshot` が devcontainer 環境で安定動作することが確認できたため、SIGUSR2 fallback は不要と判断。`apps/app` への signal handler 追加と新規 env var を排除することで production への影響を完全にゼロにできた。
- **Trade-offs**: + production 安全 / + apps/app への追加面ゼロ / + 関心の分離 / − CDP 不可時の fallback がないが、devcontainer では `--inspect` 起動が前提のため実質問題なし。
- **Follow-up**: CDP の挙動は Node 24 で再確認済。将来 SIGUSR2 fallback が必要になった場合は本 spec で再評価。

### Decision: L1 / L2 の env var は新規追加とし、未指定時 default を本 spec 推奨値とする
- **Context**: 既存 production の default を変更すると無告知の振る舞い変化が起きる。
- **Alternatives Considered**:
  1. Default 据え置き、env var override のみ追加
  2. **Default を本 spec 推奨値に変更し、env var で従来動作に戻せるようにする**
- **Selected Approach**: 2 を採用。`MONGO_MAX_POOL_SIZE` default `10`, `MONGO_MIN_POOL_SIZE` default `2`。OTel allow-list は default で明示集合のみ enable、`OTEL_AUTO_INSTRUMENTATION_PROFILE=all` で従来動作復元。
- **Rationale**: 本 spec の目的（RSS 削減）が default の変更で自動的に効き、運用者は env var で即座に戻せる。
- **Trade-offs**: + 自動的に効果 / − 既存 deployment の振る舞い変化を release notes で告知する必要。
- **Follow-up**: CHANGELOG への記載必須。

### Decision: L5 は dynamic 検証なしで常時実装、L3 sweeper / L4 backpressure は条件付き
- **Context**: defensive 修正は影響が小さく、確認なしでも入れた方が将来 debugging で得。
- **Selected Approach**: L5 (try/catch + logger) は常時実装。L3 sweeper / L4 backpressure は Drain 後 snapshot の retained constructor 差分で問題量が確認された場合のみ実装。
- **Rationale**: 要件と一致 / 不要実装回避。
- **Follow-up**: verification report で sweeper / backpressure の判定根拠を明示。

### Decision: Metric 名は `growi.yjs.docs.count`
- **Context**: 既存 OTel custom-metrics の命名規約（`growi.*` for GROWI-specific）に従う。
- **Selected Approach**: `growi.yjs.docs.count`（unit: `{document}`, type: Observable Gauge）。
- **Rationale**: `opentelemetry` spec の Boundary に整合、receiver 側ダッシュボード命名の一貫性。
- **Follow-up**: `opentelemetry` spec の Metric Schema 表を本 metric 追加に合わせて update（同 spec の Revalidation Trigger 該当）。

## Risks & Mitigations
- **R1: SIGUSR2 ハンドラと Node inspector の衝突** — `MEMORY_PROFILING_ENABLED` で gate し production では絶対に登録しない。devcontainer で `--inspect` 併用時の smoke を実装後に行う。
- **R2: Mongoose pool size 縮小による性能リグレッション** — 大規模テナント（高トラフィック）では `maxPoolSize: 10` が飽和する可能性。env var で運用者 override 可能、release notes で「大規模テナントはチューニング推奨」と明示。
- **R3: OTel auto-instrumentation 絞り込みでトレース欠落** — 「現状観測スパン種」と「絞り込み後スパン種」を実装前に diff。意図しない欠落があれば allow-list に追加。
- **R4: Heap snapshot ファイルの肥大化** — Snapshot 1 枚 50–300 MB 想定。`tmp/memory-leak-investigation/` のみに置き、`.gitignore` 確認 + verification report には集計値のみ。
- **R5: y-websocket abort シナリオ（half-close）再現困難** — TCP RST 送信は OS / Node 制約あり。`socket.destroy()` でカーネル close を強制。再現できない finding は inconclusive 扱い。

## References
- Part 1（本ファイル上部）— 静的解析レポート L1-L5
- [.kiro/specs/memory-leak-investigation/brief.md](./brief.md)
- [.kiro/specs/opentelemetry/design.md](../opentelemetry/design.md) — custom-metrics 統合パターン
- [.claude/rules/devcontainer.md](../../.claude/rules/devcontainer.md)
- Node.js: [Inspector](https://nodejs.org/api/inspector.html), [v8.writeHeapSnapshot](https://nodejs.org/api/v8.html#v8writeheapsnapshotfilename)
- [Chrome DevTools Protocol — HeapProfiler](https://chromedevtools.github.io/devtools-protocol/v8/HeapProfiler/)
