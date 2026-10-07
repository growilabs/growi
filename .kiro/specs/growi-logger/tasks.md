# Implementation History

All tasks completed (2026-03-23 → 2026-04-06). This section records the implementation scope for future reference.

- [x] 1. Scaffold `@growi/logger` shared package — package.json (pino v9.x, minimatch, pino-pretty peer), TypeScript ESM config, vitest setup, package entry points (main/types/browser)
- [x] 2. Environment variable parsing and level resolution — `EnvVarParser` (reads DEBUG/TRACE/INFO/WARN/ERROR/FATAL), `LevelResolver` (minimatch glob matching, env-override precedence)
- [x] 3. Transport factory — `TransportFactory` for Node.js dev (bunyan-format), prod+FORMAT_NODE_LOG (pino-pretty singleLine), prod default (raw JSON), and browser (console)
- [x] 4. Logger factory — `initializeLoggerFactory` (spawns one Worker thread), `loggerFactory(name)` (child logger cache, level resolution)
- [x] 5. Migrate shared packages — packages/slack, packages/remark-attachment-refs, packages/remark-lsx; fix pino-style call sites (object-first argument order)
- [x] 6. Migrate apps/slackbot-proxy — logger factory, pino-http HTTP middleware, type imports, pino-style call sites
- [x] 7. Migrate apps/app — logger factory, pino-http HTTP middleware, DiagLoggerPinoAdapter (OTel), bunyan type references
- [x] 8. Remove all bunyan/morgan dependencies; verify no residual imports across monorepo
- [x] 9. Full monorepo validation — lint, type-check, test, build for @growi/app, @growi/slackbot-proxy, @growi/logger
- [x] 10. Differentiate pino-pretty `singleLine`: dev=false (multi-line context), prod+FORMAT_NODE_LOG=true (concise one-liners)
- [x] 11. Morgan-like HTTP formatting — `customSuccessMessage`, `customErrorMessage`, `customLogLevel` in pino-http config
- [x] 12. Bunyan-format custom transport (`src/dev/bunyan-format.ts`) — `HH:mm:ss.SSSZ LEVEL name: message` format, colorization, NO_COLOR support, pino.transport() worker thread
- [x] 13. `createHttpLoggerMiddleware` — encapsulate pino-http in `@growi/logger`; move morgan-like options inside; add to @growi/logger deps
- [x] 14. Dev-only module isolation (`src/dev/`) and browser bundle fix — lazy pino-http import, extended `ignore` field in bunyan-format
