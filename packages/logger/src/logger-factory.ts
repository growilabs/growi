import type { Logger } from 'pino';
import pino from 'pino';

import { parseEnvLevels } from './env-var-parser';
import { resolveLevel } from './level-resolver';
import {
  createBrowserOptions,
  createNodeTransportOptions,
} from './transport-factory';
import type { LoggerConfig, LoggerFactoryOptions } from './types';

const isBrowser =
  typeof window !== 'undefined' && typeof window.document !== 'undefined';

let moduleConfig: LoggerConfig = { default: 'info' };
let envOverrides: Omit<LoggerConfig, 'default'> = {};
const loggerCache = new Map<string, Logger>();

// Shared root logger. pino.transport() is called once here so that all
// namespace loggers share a single Worker thread (pino's performance model).
let rootLogger: Logger | null = null;

function assertRootLogger(logger: Logger | null): asserts logger is Logger {
  if (logger == null) {
    throw new Error(
      'rootLogger is not initialized. Call initializeLoggerFactory() first.',
    );
  }
}

/**
 * Initialize the logger factory with configuration.
 * Creates the pino transport and root logger ONCE so that all namespace
 * loggers share a single Worker thread — preserving pino's performance model.
 * Must be called once at application startup before any loggerFactory() calls.
 * Subsequent calls clear the cache and create a fresh root logger.
 */
export function initializeLoggerFactory(options: LoggerFactoryOptions): void {
  moduleConfig = options.config;
  envOverrides = parseEnvLevels();
  loggerCache.clear();

  const isProduction = process.env.NODE_ENV === 'production';

  if (isBrowser) {
    // Browser: no Worker thread involved; use pino's built-in browser mode.
    // Root level is 'trace' so each child can apply its own resolved level.
    const { browser } = createBrowserOptions(isProduction);
    rootLogger = pino({ level: 'trace', browser });
  } else {
    // Node.js: call pino.transport() ONCE here.
    // Every subsequent loggerFactory() call uses rootLogger.child() which
    // shares this single Worker thread rather than spawning a new one.
    const { transport } = createNodeTransportOptions(isProduction);
    rootLogger =
      transport != null
        ? pino({ level: 'trace' }, pino.transport(transport))
        : pino({ level: 'trace' });
  }
}

/**
 * Create or retrieve a cached pino logger for the given namespace.
 * Returns a child of the shared root logger so the Worker thread is reused.
 */
export function loggerFactory(name: string): Logger {
  const cached = loggerCache.get(name);
  if (cached != null) {
    return cached;
  }

  if (rootLogger == null) {
    // Auto-initialize with default config if the caller skipped the explicit init.
    initializeLoggerFactory({ config: moduleConfig });
  }

  assertRootLogger(rootLogger);

  const level = resolveLevel(name, moduleConfig, envOverrides);

  // child() shares the root logger's transport — no new Worker thread spawned.
  const logger = rootLogger.child({ name });
  logger.level = level;

  loggerCache.set(name, logger);
  return logger;
}
