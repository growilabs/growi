# Requirements Document

## Introduction

`@growi/logger` is the shared logging package for the GROWI monorepo, wrapping pino with namespace-based level control, platform detection (Node.js/browser), and Express HTTP middleware. All GROWI applications and packages import from `@growi/logger` as the single logging entry point.

## Requirements

### Requirement 1: Logger Factory with Namespace Support

**Objective:** Provide `loggerFactory(name: string)` returning a pino logger bound to the given namespace, so developers can identify the source of log messages and control granularity per module.

**Summary**: `loggerFactory(name)` returns a cached pino child logger for the namespace — same namespace always returns the same instance. Namespaces follow colon-delimited hierarchical convention (e.g., `growi:service:page`). The logger exposes `.info()`, `.debug()`, `.warn()`, `.error()`, `.trace()`, and `.fatal()` methods compatible with all existing call sites.

### Requirement 2: Namespace-Based Log Level Configuration via Config Files

**Objective:** Load per-namespace log levels from configuration objects (separate for dev and prod), allowing fine-tuned verbosity per module without restart.

**Summary**: Accepts a `LoggerConfig` object mapping namespace patterns to log levels (e.g., `{ 'growi:service:*': 'debug', 'default': 'info' }`). Uses minimatch-compatible glob patterns. When no pattern matches, falls back to the `default` level. Per-app loggerFactory wrappers load dev/prod config files and pass the result to `initializeLoggerFactory`.

### Requirement 3: Environment Variable-Based Log Level Override

**Objective:** Override log levels at runtime via environment variables, enabling debug/trace logging for specific namespaces without modifying config files.

**Summary**: Reads `DEBUG`, `TRACE`, `INFO`, `WARN`, `ERROR`, and `FATAL` environment variables. Each supports comma-separated namespace patterns with glob wildcards (e.g., `DEBUG=growi:routes:*,growi:service:page`). Environment variable matches take precedence over config file entries.

### Requirement 4: Platform-Aware Logger (Node.js and Browser)

**Objective:** Work seamlessly in both Node.js and browser environments using the same `loggerFactory` import.

**Summary**: Detects runtime environment via `typeof window` check and applies appropriate transport. In browsers, outputs to the developer console; defaults to `error` level in production to minimize console noise. In Node.js, uses transport-based formatting as defined in Requirement 5.

### Requirement 5: Output Formatting (Development vs Production)

**Objective:** Provide distinct log output formats for development (human-readable) and production (structured JSON).

**Summary**: Development uses the bunyan-format custom transport (`HH:mm:ss.SSSZ LEVEL name: message` format, colorized). Production defaults to raw JSON. When `FORMAT_NODE_LOG` is set, production uses standard pino-pretty with `singleLine: true`. The logger namespace is included in all output.

### Requirement 6: HTTP Request Logging

**Objective:** Provide Express HTTP request logging via `createHttpLoggerMiddleware()`, encapsulating pino-http so consumer apps do not depend on it directly.

**Summary**: `createHttpLoggerMiddleware(options?)` returns Express-compatible middleware. In development, applies morgan-like message formatting (method, URL, status, response time) via dynamic import of `src/dev/morgan-like-format-options.ts`. In production, uses pino-http's default format. Static file paths can be excluded via `autoLogging.ignore`.

### Requirement 7: OpenTelemetry Integration

**Objective:** Integrate with OpenTelemetry diagnostics so observability tooling continues to function.

**Summary**: `DiagLoggerPinoAdapter` in apps/app wraps pino as an OTel `DiagLogger`, mapping `verbose` to pino `trace`. The OTel SDK configuration disables `@opentelemetry/instrumentation-pino`.

### Requirement 8: Multi-App Consistency

**Objective:** All GROWI monorepo applications use the same pino-based logging solution from `@growi/logger`.

**Summary**: `apps/app`, `apps/slackbot-proxy`, `packages/slack`, `packages/remark-attachment-refs`, and `packages/remark-lsx` all import from `@growi/logger` via `workspace:*`. The package is `"private": true` — monorepo-internal only, not published to npm.

### Requirement 10: Pino Logger Type Export

**Objective:** Export a TypeScript type for logger instances compatible with pino-http and other pino-ecosystem packages.

**Summary**: `@growi/logger` exports `Logger<string>` (not the default `Logger<never>`) so the type is assignable to pino-http's `logger` option and other external APIs. Consumers type-annotate logger variables using this export without importing pino directly.

### Requirement 11: Single Worker Thread Performance Model

**Objective:** Honor pino's design philosophy of minimal main-thread overhead.

**Summary**: `pino.transport()` is called exactly once in `initializeLoggerFactory()`. All namespace loggers are created via `rootLogger.child({ name })`, sharing the single Worker thread. The root logger level is `'trace'` so children can independently apply their resolved level. The Worker thread count never exceeds 1, regardless of namespace count.

### Requirement 12: Bunyan-Like Output Format (Development Only)

**Objective:** Provide human-readable log output in development mode matching the legacy bunyan-format "short" style.

**Summary**: In development, each log line uses `HH:mm:ss.SSSZ LEVEL name: message` with 5-char right-aligned level labels and level-based colorization (cyan/green/yellow/red). Implemented as a custom pino transport at `src/dev/bunyan-format.ts` — only loaded in development. Standard pino-pretty is used for `FORMAT_NODE_LOG` in production. The `NO_COLOR` environment variable is respected.

### Requirement 13: HTTP Logger Middleware Encapsulation

**Objective:** Encapsulate pino-http within `@growi/logger` so consumer apps do not import pino-http directly.

**Summary**: `createHttpLoggerMiddleware(options?)` is the sole HTTP logging API. `pino-http` is a dependency of `@growi/logger`, imported lazily inside the async function body (preventing browser bundle inclusion via Turbopack/webpack). Morgan-like formatting (`src/dev/morgan-like-format-options.ts`) is dynamically imported only in development. Status codes are colorized (2xx=green, 3xx=cyan, 4xx=yellow, 5xx=red) with `NO_COLOR` env var support.
