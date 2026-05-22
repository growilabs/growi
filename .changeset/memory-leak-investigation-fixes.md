---
"@growi/app": patch
---

## Server-side memory-leak investigation: operator-facing changes

### New default values for MongoDB connection pool

The connection pool size is now configurable via environment variables with explicit defaults:

| Variable | Default | Description |
|---|---|---|
| `MONGO_MAX_POOL_SIZE` | `10` | Maximum number of connections in the pool |
| `MONGO_MIN_POOL_SIZE` | `2` | Minimum number of connections kept open |

To restore the previous behavior (driver defaults), set `MONGO_MAX_POOL_SIZE` and `MONGO_MIN_POOL_SIZE` to the values your deployment requires.

### OpenTelemetry auto-instrumentation now defaults to allow-list mode

The default `OTEL_AUTO_INSTRUMENTATION_PROFILE` is now `minimal`, which enables only the four instrumentations used by GROWI:

- `@opentelemetry/instrumentation-http`
- `@opentelemetry/instrumentation-express`
- `@opentelemetry/instrumentation-mongodb`
- `@opentelemetry/instrumentation-mongoose`

All other auto-instrumentations are disabled by default to reduce trace overhead. To restore the previous behavior (all instrumentations enabled except pino and fs), set:

```
OTEL_AUTO_INSTRUMENTATION_PROFILE=all
```

### New metric: `growi.yjs.docs.count`

A new Observable Gauge metric `growi.yjs.docs.count` (unit: `{document}`) is emitted when OTel metrics are enabled. It reports the current number of collaborative documents held in memory by the y-websocket server. Use this metric to detect document accumulation over time.

### Rollback reference

| Change | Rollback env var |
|---|---|
| MongoDB pool size | `MONGO_MAX_POOL_SIZE=<previous-value>` |
| OTel instrumentation scope | `OTEL_AUTO_INSTRUMENTATION_PROFILE=all` |
