# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.
---

## Summary
- **Feature**: `growi-logger`
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

### Phase 2: Formatting Improvement Research

#### pino-http Custom Message API (v11.0.0)
- **Context**: Need morgan-like concise HTTP log messages instead of pino-http's verbose default
- **Sources Consulted**: pino-http v11.0.0 type definitions (index.d.ts), source code (logger.js)
- **Findings**:
  - `customSuccessMessage: (req: IM, res: SR, responseTime: number) => string` — called on successful response (statusCode < 500)
  - `customErrorMessage: (req: IM, res: SR, error: Error) => string` — called on error response
  - `customReceivedMessage: (req: IM, res: SR) => string` — called when request received (optional, only if autoLogging enabled)
  - `customLogLevel: (req: IM, res: SR, error?: Error) => LevelWithSilent` — dynamic log level based on status code
  - `customSuccessObject: (req, res, val) => any` — custom fields for successful response log
  - `customErrorObject: (req, res, error, val) => any` — custom fields for error response log
  - `customAttributeKeys: { req?, res?, err?, reqId?, responseTime? }` — rename default keys
  - Response time is calculated as `Date.now() - res[startTime]` in milliseconds
  - Error conditions: error passed to handler, `res.err` set, or `res.statusCode >= 500`
- **Implications**: `customSuccessMessage` + `customErrorMessage` + `customLogLevel` are sufficient to achieve morgan-like output format

#### pino-pretty singleLine Option
- **Context**: User wants one-liner readable logs when FORMAT_NODE_LOG=true
- **Sources Consulted**: pino-pretty v13.x documentation
- **Findings**:
  - `singleLine: true` forces all log properties onto a single line
  - `singleLine: false` (default) outputs properties on separate indented lines
  - Combined with `ignore: 'pid,hostname'`, singleLine produces concise output
  - The `messageFormat` option can further customize the format string
- **Implications**: Changing `singleLine` from `false` to `true` in the production FORMAT_NODE_LOG path directly addresses the user's readability concern

#### FORMAT_NODE_LOG Default Semantics Analysis
- **Context**: `isFormattedOutputEnabled()` returns `true` when env var is unset; production JSON depends on `.env.production`
- **Analysis**:
  - `.env.production` sets `FORMAT_NODE_LOG=false` — this is the mechanism that ensures JSON in production
  - CI sets `FORMAT_NODE_LOG=true` explicitly — not affected by default change
  - If `.env.production` fails to load in a Docker override scenario, production would silently get pino-pretty
  - However, inverting the default is a behavioral change with broader implications
- **Decision**: Defer to separate PR. Current behavior is correct in practice (`.env.production` always loaded by Next.js dotenv-flow).

## Phase 3: Implementation Discoveries

### Browser Bundle Compatibility — pino-http Top-Level Import
- **Context**: `pino-http` was initially imported at the module top-level in `http-logger.ts`. This caused Turbopack to include the Node.js-only module in browser bundles, producing `TypeError: __turbopack_context__.r(...).symbols is undefined`.
- **Root cause**: `@growi/logger` is imported by shared page code that runs in both browser and server contexts. Any top-level import of a Node.js-only module (like pino-http) gets pulled into the browser bundle.
- **Fix**: Move the `pino-http` import inside the async function body using dynamic import: `const { default: pinoHttp } = await import('pino-http')`. This defers the import to runtime when the function is actually called (server-side only).
- **Pattern**: This is the standard pattern for Node.js-only modules in packages shared with browser code. Apply the same treatment to any future Node.js-only additions to `@growi/logger`.

### Dev-Only Module Physical Isolation (`src/dev/`)
- **Context**: `bunyan-format.ts` (custom pino transport) and `morgan-like-format-options.ts` were initially placed at `src/transports/` and `src/` root respectively, mixed with production modules.
- **Problem**: No clear boundary between dev-only and production-safe modules; risk of accidentally importing dev modules in production paths.
- **Fix**: Created `src/dev/` directory as the explicit boundary for development-only modules. `TransportFactory` references `./dev/bunyan-format.js` only in the dev branch — the path is never constructed in production code paths.
- **Vite config**: `preserveModules: true` ensures `src/dev/bunyan-format.ts` builds to `dist/dev/bunyan-format.js` with the exact path that `pino.transport({ target: ... })` references at runtime.

### Single Worker Thread Model — Critical Implementation Detail
- **Context**: Initial implementation called `pino.transport()` inside `loggerFactory(name)`, spawning a new Worker thread for each namespace.
- **Fix**: Refactored so `pino.transport()` is called **once** in `initializeLoggerFactory`, and `loggerFactory(name)` calls `rootLogger.child({ name })` to create namespace-bound loggers sharing the single Worker thread.
- **Root logger level**: Must be set to `'trace'` (not `'info'`) so child loggers can independently set their resolved level without being silenced by the root. If the root is `'info'`, a child with `level: 'debug'` will still be filtered at the root level.
- **Constraint for future changes**: Never call `pino.transport()` or `pino()` inside `loggerFactory()`. All transport setup belongs in `initializeLoggerFactory()`.

### pino Logger Type Compatibility with pino-http
- **Context**: `loggerFactory()` returned `pino.Logger<never>` (the default), which is not assignable to pino-http's expected `Logger` type.
- **Fix**: Export `Logger<string>` from `@growi/logger` and type `loggerFactory` to return `Logger<string>`. This is compatible with pino-http's `logger` option.
- **Why `<string>` not `<never>`**: pino's default generic `CustomLevels` is `never`, which makes the type incompatible with APIs expecting custom levels to potentially be strings. `Logger<string>` is the correct type for external APIs.

### `@growi/logger` Package Visibility
- **Decision**: `"private": true` is correct and intentional.
- **Rationale**: All consumers (`apps/app`, `apps/slackbot-proxy`, `packages/slack`, etc.) are monorepo-internal packages that reference `@growi/logger` via `workspace:*` protocol. The `private` flag only prevents npm publish, not workspace usage. `@growi/logger` is logging infrastructure — there is no reason to expose it externally (unlike `@growi/core` or `@growi/pluginkit` which are published for external plugin developers).

## References
- [pino API docs](https://github.com/pinojs/pino/blob/main/docs/api.md)
- [pino browser docs](https://github.com/pinojs/pino/blob/main/docs/browser.md)
- [pino-pretty npm](https://www.npmjs.com/package/pino-pretty)
- [pino-http npm](https://www.npmjs.com/package/pino-http)
- [@opentelemetry/instrumentation-pino](https://www.npmjs.com/package/@opentelemetry/instrumentation-pino)
- [universal-bunyan source](https://github.com/weseek/universal-bunyan) — current implementation reference
