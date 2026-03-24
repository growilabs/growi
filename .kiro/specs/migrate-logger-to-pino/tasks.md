# Implementation Plan

- [ ] 1. Scaffold the @growi/logger shared package
- [ ] 1.1 Initialize the package directory, package.json, and TypeScript configuration within the monorepo packages directory
  - Create the workspace entry as `@growi/logger` with pino v9.x and minimatch as dependencies, pino-pretty as an optional peer dependency
  - Configure TypeScript with strict mode, ESM output, and appropriate path aliases
  - Set up the package entry points (main, types, browser) so that bundlers resolve the correct build for Node.js vs browser
  - Add vitest configuration for unit testing within the package
  - _Requirements: 8.5_

- [ ] 1.2 Define the shared type contracts and configuration interface
  - Define the `LoggerConfig` type representing a namespace-pattern-to-level mapping (including a `default` key)
  - Define the `LoggerFactoryOptions` type accepted by the initialization function
  - Export the pino `Logger` type so consumers can type-annotate their logger variables without importing pino directly
  - _Requirements: 10.3_

- [ ] 2. Implement environment variable parsing and level resolution
- [ ] 2.1 (P) Build the environment variable parser
  - Read the six log-level environment variables (`DEBUG`, `TRACE`, `INFO`, `WARN`, `ERROR`, `FATAL`) from the process environment
  - Split each variable's value by commas and trim whitespace to extract individual namespace patterns
  - Return a flat config map where each namespace pattern maps to its corresponding level string
  - Handle edge cases: empty values, missing variables, duplicate patterns (last wins)
  - Write unit tests covering: single variable with multiple patterns, all six variables set, no variables set, whitespace handling
  - _Requirements: 3.1, 3.4, 3.5_

- [ ] 2.2 (P) Build the level resolver with glob pattern matching
  - Accept a namespace string, a config map, and an env-override map; return the resolved level
  - Check env-override map first (using minimatch for glob matching), then config map, then fall back to the config `default` entry
  - When multiple patterns match, prefer the most specific (longest non-wildcard prefix) match
  - Write unit tests covering: exact match, glob wildcard match, env override precedence over config, fallback to default, no matching pattern
  - _Requirements: 2.1, 2.3, 2.4, 3.2, 3.3_

- [ ] 3. Implement the transport factory for dev, prod, and browser environments
- [ ] 3.1 (P) Build the Node.js transport configuration
  - In development mode, produce pino-pretty transport options with human-readable timestamps, hidden pid/hostname fields, and multi-line output
  - In production mode, produce raw JSON output to stdout by default
  - When the `FORMAT_NODE_LOG` environment variable is unset or truthy in production, produce pino-pretty transport options with long-format output instead of raw JSON
  - Include the logger namespace (`name` field) in all output configurations
  - Write unit tests verifying correct options for each combination of NODE_ENV and FORMAT_NODE_LOG
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 3.2 (P) Build the browser transport configuration
  - Detect the browser environment using window/document checks
  - In browser development mode, produce pino browser options that output to the developer console with the resolved namespace level
  - In browser production mode, produce pino browser options that default to `error` level to suppress non-critical console output
  - Write unit tests verifying browser options for dev and prod scenarios
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 4. Implement the logger factory with caching and platform detection
- [ ] 4.1 Build the initialization and factory functions
  - Implement `initializeLoggerFactory(options)` that stores the merged configuration, pre-parses environment overrides, and prepares the transport config
  - Implement `loggerFactory(name)` that checks the cache for an existing logger, resolves the level via the level resolver, creates a pino instance with appropriate transport options, caches it, and returns it
  - Detect the runtime platform (Node.js vs browser) and apply the corresponding transport configuration from the transport factory
  - Ensure the module exports `loggerFactory` as the default export and `initializeLoggerFactory` as a named export for backward compatibility with existing import patterns
  - Write unit tests covering: cache hit returns same instance, different namespaces return different instances, initialization stores config correctly
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 10.1_

- [ ] 5. Migrate shared packages to @growi/logger (small scope first)
- [ ] 5.1 (P) Update packages/slack logger to use @growi/logger
  - Replace the logger factory implementation to import from `@growi/logger` instead of universal-bunyan
  - Update the inline config (`{ default: 'info' }`) to use the @growi/logger initialization pattern
  - Replace bunyan type imports with the @growi/logger Logger type
  - Add `@growi/logger` to packages/slack dependencies
  - Run TypeScript compilation to verify no type errors
  - _Requirements: 8.3_

- [ ] 5.2 (P) Update packages/remark-attachment-refs logger to use @growi/logger
  - Replace the logger factory implementation to import from `@growi/logger`
  - Update configuration and type imports to match the new package
  - Add `@growi/logger` to packages/remark-attachment-refs dependencies
  - Run TypeScript compilation to verify no type errors
  - _Requirements: 8.4_

- [ ] 6. Migrate apps/slackbot-proxy to @growi/logger
- [ ] 6.1 Replace the logger factory and HTTP middleware in slackbot-proxy
  - Update the slackbot-proxy logger utility to import from `@growi/logger` and call `initializeLoggerFactory` with its existing dev/prod config
  - Replace express-bunyan-logger and morgan usage in the server setup with pino-http middleware
  - Replace all `import type Logger from 'bunyan'` references with the @growi/logger Logger type
  - Add `@growi/logger` and `pino-http` to slackbot-proxy dependencies
  - Run TypeScript compilation to verify no type errors
  - _Requirements: 8.2, 6.1_

- [ ] 7. Migrate apps/app to @growi/logger (largest scope)
- [ ] 7.1 Replace the logger factory module in apps/app
  - Update the apps/app logger utility to import from `@growi/logger` instead of `universal-bunyan`
  - Call `initializeLoggerFactory` at application startup with the existing dev/prod config files (preserve current config content)
  - Re-export `loggerFactory` as the default export so all existing consumer imports continue to work unchanged
  - Add `@growi/logger` to apps/app dependencies and ensure pino-pretty is available for development formatting
  - _Requirements: 8.1, 2.2_

- [ ] 7.2 Replace HTTP request logging middleware in apps/app
  - Remove the morgan middleware (development mode) and express-bunyan-logger middleware (production mode) from the Express initialization
  - Add pino-http middleware configured with a logger from the factory using the `express` namespace
  - Configure route skipping to exclude `/_next/static/` paths in non-production mode
  - Verify the middleware produces log entries containing method, URL, status code, and response time
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 7.3 Update the OpenTelemetry diagnostic logger adapter
  - Rename the adapter class from `DiagLoggerBunyanAdapter` to `DiagLoggerPinoAdapter` and update the import to use pino types
  - Preserve the existing `parseMessage` helper logic that parses JSON strings and merges argument objects
  - Confirm the verbose-to-trace level mapping continues to work with pino's trace level
  - Update the OpenTelemetry SDK configuration to disable `@opentelemetry/instrumentation-pino` instead of `@opentelemetry/instrumentation-bunyan`
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 7.4 Update all bunyan type references in apps/app source files
  - Replace `import type Logger from 'bunyan'` with the Logger type exported from `@growi/logger` across all source files in apps/app
  - Verify that pino's Logger type is compatible with all existing usage patterns (info, debug, warn, error, trace, fatal method calls)
  - Run the TypeScript compiler to confirm no type errors
  - _Requirements: 10.1, 10.2, 10.3_

- [ ] 8. Remove old logging dependencies and verify cleanup
- [ ] 8.1 Remove bunyan-related packages from all package.json files
  - Remove `bunyan`, `universal-bunyan`, `bunyan-format`, `express-bunyan-logger`, `browser-bunyan`, `@browser-bunyan/console-formatted-stream`, `@types/bunyan` from every package.json in the monorepo
  - Remove `morgan` and `@types/morgan` from every package.json in the monorepo
  - Run `pnpm install` to update the lockfile and verify no broken peer dependency warnings
  - _Requirements: 9.1, 9.2_

- [ ] 8.2 Verify no residual references to removed packages
  - Search all source files for any remaining imports or requires of the removed packages (bunyan, universal-bunyan, browser-bunyan, express-bunyan-logger, morgan, bunyan-format)
  - Search all configuration and type definition files for stale bunyan references
  - Fix any remaining references found during the search
  - _Requirements: 9.3_

- [ ] 9. Run full monorepo validation
- [ ] 9.1 Execute lint, type-check, test, and build across the monorepo
  - Run `turbo run lint --filter @growi/app` and fix any lint errors related to the migration
  - Run `turbo run test --filter @growi/app` and verify all existing tests pass
  - Run `turbo run build --filter @growi/app` and confirm the production build succeeds
  - Run the same checks for slackbot-proxy and any other affected packages
  - Verify the @growi/logger package's own tests pass
  - _Requirements: 1.4, 8.1, 8.2, 8.3, 8.4, 10.1, 10.2_
