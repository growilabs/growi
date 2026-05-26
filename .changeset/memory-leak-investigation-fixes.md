---
"@growi/app": patch
---

## Server-side memory-leak investigation: operator-facing changes

### New default values for MongoDB connection pool

The connection pool size is now configurable via environment variables with explicit defaults:

| Variable | Default | Description |
|---|---|---|
| `MONGO_MAX_POOL_SIZE` | `15` | Maximum number of connections in the pool |
| `MONGO_MIN_POOL_SIZE` | `2` | Minimum number of connections kept open |

To restore the previous behavior (driver defaults), set `MONGO_MAX_POOL_SIZE` and `MONGO_MIN_POOL_SIZE` to the values your deployment requires.

### OpenTelemetry instrumentation set is now fixed to the four GROWI uses

`@opentelemetry/auto-instrumentations-node` is no longer used. The four instrumentations actually exercised by GROWI are now imported and instantiated directly:

- `@opentelemetry/instrumentation-http`
- `@opentelemetry/instrumentation-express`
- `@opentelemetry/instrumentation-mongodb`
- `@opentelemetry/instrumentation-mongoose`

The `OTEL_AUTO_INSTRUMENTATION_PROFILE` environment variable that briefly existed in pre-release builds has been removed; there is no runtime knob to enable additional instrumentations. If you need an instrumentation not in this set, add it directly to `node-sdk-configuration.ts`.

### New metric: `growi.yjs.docs.count`

A new Observable Gauge metric `growi.yjs.docs.count` (unit: `{document}`) is emitted when OTel metrics are enabled. It reports the current number of collaborative documents held in memory by the y-websocket server. Use this metric to detect document accumulation over time.

### Rollback reference

| Change | Rollback env var |
|---|---|
| MongoDB pool size | `MONGO_MAX_POOL_SIZE=<previous-value>` |
| OTel instrumentation scope | No env var. Edit `node-sdk-configuration.ts` to add instrumentations. |
