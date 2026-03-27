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

/**
 * Initialize the logger factory with configuration.
 * Must be called once at application startup before any loggerFactory() calls.
 * Subsequent calls clear the cache and apply the new config.
 */
export function initializeLoggerFactory(options: LoggerFactoryOptions): void {
  moduleConfig = options.config;
  envOverrides = parseEnvLevels();
  loggerCache.clear();
}

/**
 * Create or retrieve a cached pino logger for the given namespace.
 */
export function loggerFactory(name: string): Logger {
  const cached = loggerCache.get(name);
  if (cached != null) {
    return cached;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const level = resolveLevel(name, moduleConfig, envOverrides);

  let logger: Logger;

  if (isBrowser) {
    const browserOpts = createBrowserOptions(isProduction);
    logger = pino({
      name,
      level,
      ...browserOpts,
    });
  } else {
    const { transport } = createNodeTransportOptions(isProduction);
    logger =
      transport != null
        ? pino({ name, level }, pino.transport(transport))
        : pino({ name, level });
  }

  loggerCache.set(name, logger);
  return logger;
}
