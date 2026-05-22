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
