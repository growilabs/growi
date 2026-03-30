# Gap Analysis: migrate-logger-to-pino

## Analysis Summary

- **Migration status**: The bunyan → pino migration is **structurally complete** — all bunyan/morgan/browser-bunyan dependencies removed, `@growi/logger` package created, all apps integrated.
- **Primary gap**: Log output formatting does not meet the user's readability goals. pino-pretty is configured with `singleLine: false` (multi-line), but the user wants **one-liner, morgan-like readable output** when `FORMAT_NODE_LOG=true`.
- **HTTP request logging gap**: `pino-http` uses default message templates, producing verbose multi-line output. No `customSuccessMessage` or `customReceivedMessage` configured — unlike morgan's concise `GET /path 200 12ms` format.
- **FORMAT_NODE_LOG semantics mismatch**: The code defaults to formatted output when unset (`isFormattedOutputEnabled()` returns `true`), but `.env.production` overrides this to `false`. The **intent** is "production = JSON by default", but the **code logic** says "unset = formatted". If `.env.production` fails to load, production gets pino-pretty instead of JSON.
- **Effort**: S–M (1–5 days) depending on scope of format customization.

---

## 1. Current State

### What's Done (Complete)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Req 1: Logger Factory with Namespace | ✅ Done | `@growi/logger` package, `loggerFactory()`, child logger caching |
| Req 2: Config-file log levels | ✅ Done | `config.dev.ts` / `config.prod.ts` with minimatch glob patterns |
| Req 3: Env var overrides | ✅ Done | `DEBUG`, `TRACE`, `INFO`, `WARN`, `ERROR`, `FATAL` env vars |
| Req 4: Platform-aware (Node/Browser) | ✅ Done | `isBrowser` detection, browser console output, `error`-only in prod |
| Req 5: Dev vs Prod formatting | ⚠️ Partial | See Gap A and Gap B below |
| Req 6: HTTP request logging | ⚠️ Partial | pino-http integrated but format not customized — see Gap C |
| Req 7: OpenTelemetry integration | ✅ Done | `DiagLoggerPinoAdapter` maps verbose→trace |
| Req 8: Multi-app consistency | ✅ Done | apps/app, slackbot-proxy, packages all use `@growi/logger` |
| Req 9: Dependency cleanup | ✅ Done | Zero bunyan/morgan references remain |
| Req 10: Backward-compatible API | ✅ Done | Same `.info()`, `.debug()`, etc. method signatures |
| Req 11: Performance (single transport) | ✅ Done | Single `pino.transport()` call, `.child()` for namespaces |

### Key Files

| File | Purpose |
|------|---------|
| `packages/logger/src/transport-factory.ts` | Transport config (pino-pretty options, FORMAT_NODE_LOG) |
| `packages/logger/src/logger-factory.ts` | Root logger creation, child logger caching |
| `packages/logger/src/level-resolver.ts` | Namespace → level resolution |
| `apps/app/src/server/crowi/index.ts:617-627` | pino-http middleware setup |
| `apps/app/.env.production` | `FORMAT_NODE_LOG=false` |

---

## 2. Identified Gaps

### Gap A: `singleLine` should be `true` when `FORMAT_NODE_LOG=true`

**Current**: `transport-factory.ts` always sets `singleLine: false` for pino-pretty (both dev and prod).

**User expectation**: When `FORMAT_NODE_LOG=true`, output should be **one-liner** for readability — similar to morgan's concise format. Multi-line output is fine for dev (where vertical space is cheap), but in production with `FORMAT_NODE_LOG=true` the goal is a quick-glance readable log stream.

**Impact**: Low. Single config value change.

### Gap B: `FORMAT_NODE_LOG` default semantics

**Current**: `isFormattedOutputEnabled()` returns `true` when `FORMAT_NODE_LOG` is unset.

```typescript
function isFormattedOutputEnabled(): boolean {
  const val = process.env.FORMAT_NODE_LOG;
  if (val === undefined || val === null) return true;  // ← unset = formatted
  return val !== 'false' && val !== '0';
}
```

**Problem**: The user's intent is:
- **Production default** → structured JSON (for log aggregation)
- **Production with `FORMAT_NODE_LOG=true`** → human-readable one-liners

Currently, production JSON output depends on `.env.production` setting `FORMAT_NODE_LOG=false`. If that file isn't loaded (e.g., Docker override, env misconfiguration), production silently gets pino-pretty instead of JSON.

**Options**:
1. **Invert the default**: `isFormattedOutputEnabled()` returns `false` when unset in production. This makes JSON the true default without relying on `.env.production`.
2. **Keep current behavior** but document the dependency on `.env.production` clearly. Simpler, lower risk of breaking CI which sets `FORMAT_NODE_LOG=true`.

### Gap C: HTTP request log format (pino-http customization)

**Current** (`apps/app/src/server/crowi/index.ts:618-626`):
```typescript
const httpLoggerOptions: PinoHttpOptions = {
  logger: loggerFactory('express'),
  ...(env !== 'production' && {
    autoLogging: {
      ignore: (req) => req.url?.startsWith('/_next/static/') ?? false,
    },
  }),
};
```

No `customSuccessMessage`, `customReceivedMessage`, or `customLogLevel` configured.

**User expectation**: Morgan-like concise one-liner output, e.g.:
```
GET /page/path 200 12ms
```

**Current pino-http default output** (with pino-pretty):
```
[timestamp] INFO (express): request completed
    req: { "method": "GET", "url": "/page/path", ... }
    res: { "statusCode": 200 }
    responseTime: 12
```

This is **much more verbose** than morgan. To achieve morgan-like readability, `pino-http` options need:

1. **`customSuccessMessage`** to produce `GET /path 200 12ms` style messages
2. **`customReceivedMessage`** (optional, can be suppressed if only logging on response)
3. Potentially **`customLogLevel`** to log 4xx/5xx at `warn`/`error` level

**Complexity**: Medium. Requires understanding pino-http's callback API and testing the output format.

### Gap D: Dev mode formatting vs production formatting distinction

**Current**: Dev and production (with FORMAT_NODE_LOG=true) use the **exact same pino-pretty config**. There's no distinction in formatting between the two.

**Opportunity**: Dev could keep `singleLine: false` (multi-line, with full context) while `FORMAT_NODE_LOG=true` in production uses `singleLine: true` (concise). This gives developers full detail locally and operators quick-glance output in production.

---

## 3. Implementation Approach Options

### Option A: Minimal — Fix singleLine + pino-http message format

**Scope**: Change `singleLine: false` → `true` in the production pino-pretty path, and add `customSuccessMessage` to pino-http.

**Files to change**:
- `packages/logger/src/transport-factory.ts` — separate dev and prod pino-pretty options
- `packages/logger/src/transport-factory.spec.ts` — update tests
- `apps/app/src/server/crowi/index.ts` — add pino-http message customization
- `apps/slackbot-proxy/src/Server.ts` — same pino-http customization

**Trade-offs**:
- ✅ Minimal changes, low risk
- ✅ Directly addresses the user's readability concern
- ❌ Does not fix the FORMAT_NODE_LOG default semantics (Gap B)

### Option B: Full — Fix formatting + FORMAT_NODE_LOG semantics

**Scope**: Everything in Option A, plus invert `isFormattedOutputEnabled()` to return `false` when unset in production.

**Additional files**:
- `packages/logger/src/transport-factory.ts` — change default logic
- `packages/logger/src/transport-factory.spec.ts` — update tests
- `apps/app/.env.production` — can remove `FORMAT_NODE_LOG=false` (now redundant)

**Trade-offs**:
- ✅ Production JSON output is guaranteed without `.env.production` dependency
- ✅ Cleaner semantics: "opt-in to formatting" rather than "opt-out of formatting"
- ❌ CI env (`FORMAT_NODE_LOG=true`) is not affected (still explicitly set)
- ❌ Slightly more risk — need to verify all environments load correctly

### Option C: Hybrid — Fix formatting now, defer semantics

**Scope**: Option A now. Document Gap B as a known issue for later resolution.

**Trade-offs**:
- ✅ Fastest to deliver visible improvement
- ✅ Defers semantic change to a separate PR for safer review
- ❌ `.env.production` dependency remains

---

## 4. Effort & Risk Assessment

| Aspect | Estimate | Justification |
|--------|----------|---------------|
| **Effort** | **S** (1–2 days) for Option A; **M** (3–4 days) for Option B | Formatting changes are config-level; pino-http customization requires testing output |
| **Risk** | **Low** | All changes are in logging formatting — no business logic impact. pino-http customization is well-documented. |

---

## 5. Research Needed (for Design Phase)

1. **pino-http `customSuccessMessage` API**: Confirm the exact callback signature and available fields (`req`, `res`, `responseTime`) in pino-http v11.
2. **pino-pretty `messageFormat` option**: Could be used to format the `name` (namespace) field inline for even more concise output.
3. **pino-http `customLogLevel`**: Decide whether 4xx → `warn` and 5xx → `error` mapping is desired (morgan didn't differentiate).
4. **`autoLogging.ignore` in production**: Currently only applied in dev. Should certain paths (e.g., health checks) also be suppressed in production?

---

## 6. Recommendations

1. **Start with Option A (Minimal)** — delivers the most visible improvement (one-liner logs, morgan-like HTTP format) with minimal risk.
2. **Prioritize Gap C (pino-http format)** — this is the most impactful change for the user's stated goal of "morgan-like one-liner readability".
3. **Address Gap B (FORMAT_NODE_LOG semantics) separately** — it's a semantic correctness issue, not a readability issue, and can be handled in a follow-up.
4. **Keep dev mode as multi-line** (`singleLine: false`) — developers benefit from seeing full context; the one-liner optimization is for production/FORMAT_NODE_LOG scenarios.
