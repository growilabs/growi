# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.
---

## Summary
- **Feature**: `migrate-logger-to-pino`
- **Discovery Scope**: Complex Integration
- **Key Findings**:
  - Pino and bunyan share identical argument patterns (`logger.info(obj, msg)`) — no call-site changes needed
  - No `logger.child()` or custom serializers used in GROWI — simplifies migration significantly
  - `@opentelemetry/instrumentation-pino` supports pino `<10`; need to verify v9.x or v10 compatibility
  - No off-the-shelf pino package replicates universal-bunyan's namespace-based level control; custom wrapper required

## Research Log

### Pino Core API Compatibility with Bunyan
- **Context**: Need to confirm argument pattern compatibility to minimize call-site changes
- **Sources Consulted**: pino GitHub docs (api.md), npm pino@10.3.1
- **Findings**:
  - Log level numeric values are identical: trace=10, debug=20, info=30, warn=40, error=50, fatal=60
  - Method signature: `logger[level]([mergingObject], [message], [...interpolationValues])` — same as bunyan
  - `name` option adds a `"name"` field to JSON output, same as bunyan
  - `msg` is the default message key (same as bunyan), configurable via `messageKey`
  - `pino.child(bindings, options)` works similarly to bunyan's `child()`
- **Implications**: Call sites using `logger.info('msg')`, `logger.info({obj}, 'msg')`, `logger.error(err)` require no changes

### Pino Browser Support
- **Context**: universal-bunyan uses browser-bunyan + ConsoleFormattedStream for client-side logging
- **Sources Consulted**: pino GitHub docs (browser.md)
- **Findings**:
  - Pino has built-in browser mode activated via package.json `browser` field
  - Maps to console methods: `console.error` (fatal/error), `console.warn`, `console.info`, `console.debug`, `console.trace`
  - `browser.asObject: true` outputs structured objects
  - `browser.write` allows custom per-level handlers
  - Level control works the same as Node.js (`level` option)
  - No separate package needed (unlike browser-bunyan)
- **Implications**: Eliminates browser-bunyan and @browser-bunyan/console-formatted-stream dependencies entirely

### Pino-Pretty as Bunyan-Format Replacement
- **Context**: universal-bunyan uses bunyan-format with `short` (dev) and `long` (prod) output modes
- **Sources Consulted**: pino-pretty npm (v13.1.3)
- **Findings**:
  - Can be used as transport (worker thread) or stream (main thread)
  - Short mode equivalent: `singleLine: true` + `ignore: 'pid,hostname'`
  - Long mode equivalent: default multi-line output
  - `translateTime: 'SYS:standard'` for human-readable timestamps
  - TTY-only pattern: conditionally enable based on `process.stdout.isTTY`
- **Implications**: Direct replacement for bunyan-format with equivalent modes

### Pino-HTTP as Morgan/Express-Bunyan-Logger Replacement
- **Context**: GROWI uses morgan (dev) and express-bunyan-logger (prod) for HTTP request logging
- **Sources Consulted**: pino-http npm (v11.0.0)
- **Findings**:
  - Express middleware with `autoLogging.ignore` for route skipping (replaces morgan's `skip`)
  - Accepts custom pino logger instance via `logger` option
  - `customLogLevel` for status-code-based level selection
  - `req.log` provides child logger with request context
  - Replaces both morgan and express-bunyan-logger in a single package
- **Implications**: Unified HTTP logging for both dev and prod, with route filtering support

### Namespace-Based Level Control
- **Context**: universal-bunyan provides namespace-to-level mapping with minimatch glob patterns and env var overrides
- **Sources Consulted**: pino-debug (v4.0.2), pino ecosystem search
- **Findings**:
  - pino-debug bridges the `debug` module but doesn't provide general namespace-level control
  - No official pino package replicates universal-bunyan's behavior
  - Custom implementation needed: wrapper that caches pino instances per namespace, reads config + env vars, applies minimatch matching
  - Can use pino's `level` option per-instance (set at creation time)
- **Implications**: Must build `@growi/logger` package as a custom wrapper around pino, replacing universal-bunyan

### OpenTelemetry Instrumentation
- **Context**: GROWI has a custom DiagLogger adapter wrapping bunyan, and disables @opentelemetry/instrumentation-bunyan
- **Sources Consulted**: @opentelemetry/instrumentation-pino npm (v0.59.0)
- **Findings**:
  - Supports pino `>=5.14.0 <10` — pino v10 may not be supported yet
  - Provides trace correlation (trace_id, span_id injection) and log sending to OTel SDK
  - GROWI's DiagLoggerBunyanAdapter pattern maps cleanly to pino (same method names)
  - Current code disables bunyan instrumentation; equivalent disable for pino instrumentation may be needed
- **Implications**: Pin pino to v9.x for OTel compatibility, or verify v10 support. DiagLogger adapter changes are minimal.

### Existing Call-Site Analysis
- **Context**: Need to understand what API surface is actually used to minimize migration risk
- **Sources Consulted**: Codebase grep across all apps and packages
- **Findings**:
  - **No `logger.child()` usage** anywhere in the codebase
  - **No custom serializers** registered or used
  - **No `logger.fields` access** or other bunyan-specific APIs
  - Call patterns: ~30% simple string, ~50% string+object, ~10% error-only, ~10% string+error
  - All loggers created via `loggerFactory(name)` — single entry point
- **Implications**: Migration is primarily a factory-level change; call sites need no modification

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Drop-in wrapper (`@growi/logger`) | Shared package providing `loggerFactory()` over pino with namespace/config/env support | Minimal call-site changes, single source of truth, testable in isolation | Must implement namespace matching (minimatch) | Mirrors universal-bunyan's role |
| Direct pino usage per app | Each app creates pino instances directly | No wrapper overhead | Duplicated config logic, inconsistent behavior across apps | Rejected: violates Req 8 |
| pino-debug bridge | Use pino-debug for namespace control | Leverages existing package | Only works with `debug()` calls, not general logging | Rejected: wrong abstraction |

## Design Decisions

### Decision: Create `@growi/logger` as Shared Package
- **Context**: universal-bunyan is a custom wrapper; need equivalent for pino
- **Alternatives Considered**:
  1. Direct pino usage in each app — too much duplication
  2. Fork/patch universal-bunyan for pino — complex, hard to maintain
  3. New shared package `@growi/logger` — clean, purpose-built
- **Selected Approach**: New `@growi/logger` package in `packages/logger/`
- **Rationale**: Single source of truth, testable, follows monorepo patterns (like @growi/core)
- **Trade-offs**: One more package to maintain, but replaces external dependency
- **Follow-up**: Define package exports, ensure tree-shaking for browser builds

### Decision: Pin Pino to v9.x for OpenTelemetry Compatibility
- **Context**: @opentelemetry/instrumentation-pino supports `<10`
- **Alternatives Considered**:
  1. Use pino v10 and skip OTel auto-instrumentation — loses correlation
  2. Use pino v9 for compatibility — safe choice
  3. Use pino v10 and verify latest instrumentation support — risky
- **Selected Approach**: Start with pino v9.x; upgrade to v10 when OTel adds support
- **Rationale**: OTel trace correlation is valuable for production observability
- **Trade-offs**: Miss latest pino features temporarily
- **Follow-up**: Monitor @opentelemetry/instrumentation-pino releases for v10 support

### Decision: Use pino-pretty as Transport in Development
- **Context**: Need human-readable output for dev, JSON for prod
- **Alternatives Considered**:
  1. pino-pretty as transport (worker thread) — standard approach
  2. pino-pretty as sync stream — simpler but blocks main thread
- **Selected Approach**: Transport for async dev logging; raw JSON in production
- **Rationale**: Transport keeps main thread clear; dev perf is less critical but the pattern is correct
- **Trade-offs**: Slightly more complex setup
- **Follow-up**: Verify transport works correctly with Next.js dev server

### Decision: Unified HTTP Logging with pino-http
- **Context**: Currently uses morgan (dev) and express-bunyan-logger (prod) — two different middlewares
- **Alternatives Considered**:
  1. Separate dev/prod middleware (maintain split) — unnecessary complexity
  2. Single pino-http middleware for both — clean, consistent
- **Selected Approach**: pino-http with route filtering replaces both
- **Rationale**: Single middleware, consistent output format, built-in request context
- **Trade-offs**: Dev output slightly different from morgan's compact format (mitigated by pino-pretty)
- **Follow-up**: Configure `autoLogging.ignore` for `/_next/static/` paths

## Risks & Mitigations
- **OTel instrumentation compatibility with pino version** — Mitigated by pinning to v9.x
- **Browser bundle size increase** — Pino browser mode is lightweight; monitor with build metrics
- **Subtle log format differences** — Acceptance test comparing output before/after
- **Missing env var behavior** — Port minimatch logic carefully with unit tests
- **Express middleware ordering** — Ensure pino-http is added at the same point in middleware chain

## References
- [pino API docs](https://github.com/pinojs/pino/blob/main/docs/api.md)
- [pino browser docs](https://github.com/pinojs/pino/blob/main/docs/browser.md)
- [pino-pretty npm](https://www.npmjs.com/package/pino-pretty)
- [pino-http npm](https://www.npmjs.com/package/pino-http)
- [@opentelemetry/instrumentation-pino](https://www.npmjs.com/package/@opentelemetry/instrumentation-pino)
- [universal-bunyan source](https://github.com/weseek/universal-bunyan) — current implementation reference
