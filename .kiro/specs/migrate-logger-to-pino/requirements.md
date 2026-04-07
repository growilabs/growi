# Requirements Document

## Introduction

GROWI currently uses bunyan as its logging library, wrapped by the custom `universal-bunyan` package (developed by WeSeek). The system provides namespace-based hierarchical logging with environment variable-driven log level control, platform detection (Node.js/Browser), and different output formatting for development and production environments. Morgan is used for HTTP request logging in development mode while `express-bunyan-logger` handles production HTTP logging.

This specification covers the complete migration from bunyan to pino, replacing `universal-bunyan` with an equivalent pino-based solution, and eliminating morgan by consolidating HTTP request logging under pino. The migration must preserve all existing functionality without degradation.

### Current Components to Replace
- `bunyan` → `pino`
- `universal-bunyan` (custom) → pino-based equivalent (official packages preferred, custom wrapper where needed)
- `bunyan-format` → pino transport equivalent (e.g., `pino-pretty`)
- `express-bunyan-logger` → `pino-http` or equivalent
- `morgan` (dev only) → consolidated into pino-http
- `browser-bunyan` / `@browser-bunyan/console-formatted-stream` → pino browser mode or equivalent
- `@types/bunyan` → pino's built-in types

## Requirements

### Requirement 1: Logger Factory with Namespace Support

**Objective:** As a developer, I want to create loggers with hierarchical namespace identifiers (e.g., `growi:service:page`), so that I can identify the source of log messages and control granularity per module.

#### Acceptance Criteria
1. The Logger Factory shall provide a `loggerFactory(name: string)` function that returns a logger instance bound to the given namespace.
2. When `loggerFactory` is called multiple times with the same namespace, the Logger Factory shall return the same cached logger instance.
3. The Logger Factory shall support colon-delimited hierarchical namespaces (e.g., `growi:crowi`, `growi:routes:login`).
4. The Logger Factory shall maintain API compatibility so that callers use `logger.info()`, `logger.debug()`, `logger.warn()`, `logger.error()`, `logger.trace()`, and `logger.fatal()` without changes to call sites.

### Requirement 2: Namespace-Based Log Level Configuration via Config Files

**Objective:** As a developer, I want to define per-namespace log levels in configuration files (separate for dev and prod), so that I can fine-tune verbosity for specific modules without restarting with different env vars.

#### Acceptance Criteria
1. The Logger Factory shall load a configuration object mapping namespace patterns to log levels (e.g., `{ 'growi:service:*': 'debug', 'default': 'info' }`).
2. The Logger Factory shall select the dev or prod configuration based on the `NODE_ENV` environment variable.
3. The Logger Factory shall support glob pattern matching (e.g., `growi:service:*`) for namespace-to-level mapping using minimatch-compatible syntax.
4. When no specific namespace match exists, the Logger Factory shall fall back to the `default` level defined in the configuration.

### Requirement 3: Environment Variable-Based Log Level Override

**Objective:** As an operator, I want to override log levels at runtime via environment variables, so that I can enable debug/trace logging for specific namespaces without modifying code or config files.

#### Acceptance Criteria
1. The Logger Factory shall read the environment variables `DEBUG`, `TRACE`, `INFO`, `WARN`, `ERROR`, and `FATAL` to parse namespace patterns.
2. When an environment variable (e.g., `DEBUG=growi:routes:*,growi:service:page`) is set, the Logger Factory shall apply the corresponding log level to all matching namespaces.
3. When both a config file entry and an environment variable match the same namespace, the environment variable shall take precedence.
4. The Logger Factory shall support comma-separated namespace patterns within a single environment variable value.
5. The Logger Factory shall support glob wildcard patterns (e.g., `growi:*`) in environment variable values.

### Requirement 4: Platform-Aware Logger (Node.js and Browser)

**Objective:** As a developer, I want the logger to work seamlessly in both Node.js (server) and browser (client) environments, so that I can use the same `loggerFactory` import in universal/shared code.

#### Acceptance Criteria
1. The Logger Factory shall detect the runtime environment (Node.js vs browser) and instantiate the appropriate logger implementation.
2. While running in a browser environment, the Logger Factory shall output logs to the browser's developer console with readable formatting.
3. While running in a browser production environment, the Logger Factory shall default to `error` level to minimize console noise.
4. While running in a Node.js environment, the Logger Factory shall output structured logs suitable for machine parsing or human-readable formatting depending on configuration.

### Requirement 5: Output Formatting (Development vs Production)

**Objective:** As a developer/operator, I want distinct log output formats for development and production, so that dev logs are human-readable while production logs are structured and parseable.

#### Acceptance Criteria
1. While `NODE_ENV` is not `production`, the Logger Factory shall output human-readable formatted logs (equivalent to bunyan-format `short` mode) using pino-pretty or an equivalent transport.
2. While `NODE_ENV` is `production`, the Logger Factory shall output structured JSON logs by default.
3. Where the `FORMAT_NODE_LOG` environment variable is set, the Logger Factory shall respect it to toggle between formatted and raw JSON output in production (formatted by default when `FORMAT_NODE_LOG` is unset or truthy).
4. The Logger Factory shall include the logger namespace in all log output so that the source module is identifiable.

### Requirement 6: HTTP Request Logging

**Objective:** As a developer/operator, I want HTTP request logging integrated with pino, so that request/response metadata is captured in a consistent format alongside application logs, eliminating the need for morgan.

#### Acceptance Criteria
1. The GROWI Server shall log HTTP requests using `pino-http` or an equivalent pino-based middleware, replacing both `morgan` (dev) and `express-bunyan-logger` (prod).
2. While in development mode, the HTTP Logger shall skip logging for Next.js static file requests (paths starting with `/_next/static/`).
3. The HTTP Logger shall use a logger instance obtained from the Logger Factory with the namespace `express` (or equivalent) for consistency with existing log namespaces.
4. The HTTP Logger shall include standard HTTP metadata (method, URL, status code, response time) in log entries.

### Requirement 7: OpenTelemetry Integration

**Objective:** As a developer, I want the pino-based logger to integrate with OpenTelemetry diagnostics, so that observability tooling continues to function after migration.

#### Acceptance Criteria
1. The OpenTelemetry DiagLogger adapter shall be updated to wrap pino instead of bunyan.
2. The OpenTelemetry DiagLogger adapter shall map OpenTelemetry verbose level to pino trace level.
3. The OpenTelemetry SDK configuration shall disable pino instrumentation if an equivalent auto-instrumentation exists (analogous to the current bunyan instrumentation disable).

### Requirement 8: Multi-App Consistency

**Objective:** As a developer, I want all GROWI monorepo applications to use the same pino-based logging solution, so that logging behavior and configuration are consistent across the platform.

#### Acceptance Criteria
1. The `apps/app` application shall use the pino-based Logger Factory.
2. The `apps/slackbot-proxy` application shall use the pino-based Logger Factory.
3. The `packages/slack` package shall use the pino-based Logger Factory.
4. The `packages/remark-attachment-refs` package shall use the pino-based Logger Factory.
5. The Logger Factory shall be published as a shared package within the monorepo so that all consumers import from a single source.

### Requirement 9: Dependency Cleanup

**Objective:** As a maintainer, I want all bunyan-related and morgan dependencies removed after migration, so that the dependency tree is clean and there is no dead code.

#### Acceptance Criteria
1. When migration is complete, the monorepo shall have no references to `bunyan`, `universal-bunyan`, `bunyan-format`, `express-bunyan-logger`, `browser-bunyan`, `@browser-bunyan/console-formatted-stream`, or `@types/bunyan` in any `package.json`.
2. When migration is complete, the monorepo shall have no references to `morgan` or `@types/morgan` in any `package.json`.
3. When migration is complete, no source file shall contain imports or requires of the removed packages.

### Requirement 11: Preserve Pino's Performance Characteristics

**Objective:** As a developer, I want the logger implementation to honour pino's design philosophy of minimal overhead in the main thread, so that migrating from bunyan does not introduce performance regressions.

#### Acceptance Criteria
1. The Logger Factory shall create pino's worker-thread transport (`pino.transport()`) **at most once** per application lifetime (i.e., during `initializeLoggerFactory`), regardless of the number of unique namespaces.
2. The Logger Factory shall create per-namespace loggers by calling `.child()` on a shared root pino instance, not by calling `pino()` and `pino.transport()` independently for each namespace.
3. The Logger Factory shall not perform any blocking I/O or expensive computation on the hot path of each log method call (level-checking is performed by pino's internal mechanism and is acceptable).
4. The number of active Worker threads used by the logger subsystem shall remain constant after the first call to `loggerFactory()`, regardless of how many distinct namespaces are subsequently requested.

### Requirement 10: Backward-Compatible Log API

**Objective:** As a developer, I want the new logger to expose the same method signatures as the current bunyan logger, so that existing log call sites require minimal or no changes.

#### Acceptance Criteria
1. The pino logger shall support `.info()`, `.debug()`, `.warn()`, `.error()`, `.trace()`, and `.fatal()` methods with the same argument patterns as bunyan (message string, optional object, optional error).
2. If bunyan-specific APIs (e.g., `logger.child()`, serializers) are used at any call sites, the pino equivalent shall be provided or the call site shall be adapted.
3. The Logger Factory shall export a TypeScript type for the logger instance that is compatible with the pino Logger type.

### Requirement 12: Bunyan-Like Output Format (Development Only)

**Objective:** As a developer, I want the log output in development mode to resemble bunyan-format's "short" mode, so that the visual experience remains familiar after migration.

#### Acceptance Criteria
1. While in development mode (`NODE_ENV !== 'production'`), the Logger Factory shall output each log line in the format: `HH:mm:ss.SSSZ LEVEL name: message` (e.g., `10:06:30.419Z DEBUG growi:service:page: some message`).
2. The level label shall be right-aligned to 5 characters (e.g., `DEBUG`, ` INFO`, ` WARN`).
3. The timestamp shall be UTC time-only in ISO 8601 format (`HH:mm:ss.SSSZ`), without date or surrounding brackets.
4. The logger namespace (`name` field) shall appear directly after the level label, followed by a colon and the message, without parentheses.
5. Log lines shall be colorized by level (cyan for DEBUG, green for INFO, yellow for WARN, red for ERROR).
6. The bunyan-like format shall be implemented as a custom pino transport module within `@growi/logger`, so that `pino.transport()` can load it in a worker thread without function serialization issues.
7. The bunyan-format transport module shall only be imported in development mode. In production, the module shall not be imported or bundled.
8. While in production mode with `FORMAT_NODE_LOG` enabled, the Logger Factory shall use standard pino-pretty (not the bunyan-format transport) for formatted output.

### Requirement 13: HTTP Logger Middleware Encapsulation

**Objective:** As a developer, I want the HTTP request logging middleware encapsulated within `@growi/logger`, so that consumer applications do not need to depend on or import `pino-http` directly.

#### Acceptance Criteria
1. The `@growi/logger` package shall export a `createHttpLoggerMiddleware(options)` function that returns Express-compatible middleware for HTTP request logging.
2. The middleware factory shall accept options for the logger namespace (defaulting to `'express'`) and optional `autoLogging` configuration (e.g., route ignore patterns).
3. While in development mode, the middleware shall apply morgan-like formatting (custom success/error messages, custom log levels) via dynamic import. In production mode, the morgan-like format module shall not be imported; pino-http's default message format shall be used.
4. After the encapsulation, `apps/app` and `apps/slackbot-proxy` shall not import `pino-http` directly; all HTTP logging shall go through `@growi/logger`.
5. The `pino-http` dependency shall move from consumer applications to `@growi/logger`'s `dependencies`.
6. The `morganLikeFormatOptions` module shall only be imported in development mode (dynamic import). In production, the module shall not be imported or bundled.
7. The `pino-http` module shall be imported lazily inside the `createHttpLoggerMiddleware` function body (not at module top-level), so that bundlers (e.g., Turbopack, webpack) do not include the Node.js-only `pino-http` in browser bundles when `@growi/logger` is imported by shared/universal code.
8. While in development mode with morgan-like formatting enabled, the HTTP log output shall suppress the verbose `req` and `res` serialized objects; the `customSuccessMessage` output (method, URL, status code, response time) is sufficient for development readability.
9. While in development mode, the morgan-like format shall colorize the HTTP status code by range (2xx=green, 3xx=cyan, 4xx=yellow, 5xx=red) and dim the response time, respecting the `NO_COLOR` environment variable.
