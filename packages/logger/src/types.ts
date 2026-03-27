import type { Logger } from 'pino';

/**
 * Maps namespace patterns (with glob support) to log level strings.
 * Must include a 'default' key as the fallback level.
 * Example: { 'growi:service:*': 'debug', 'default': 'info' }
 */
export type LoggerConfig = {
  default: string;
  [namespacePattern: string]: string;
};

/**
 * Options passed to initializeLoggerFactory().
 */
export interface LoggerFactoryOptions {
  config: LoggerConfig;
}

// Re-export pino Logger type so consumers can type-annotate without importing pino directly
export type { Logger };
