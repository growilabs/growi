import type { Logger as PinoLogger } from 'pino';

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

// Re-export pino Logger type as Logger<string> so consumers can type-annotate without importing
// pino directly, and so the type is compatible with pino-http's logger option.
export type Logger = PinoLogger<string>;
