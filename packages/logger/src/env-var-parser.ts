import type { LoggerConfig } from './types';

const LEVEL_ENV_VARS: ReadonlyArray<[string, string]> = [
  ['DEBUG', 'debug'],
  ['TRACE', 'trace'],
  ['INFO', 'info'],
  ['WARN', 'warn'],
  ['ERROR', 'error'],
  ['FATAL', 'fatal'],
];

/**
 * Parse log-level environment variables into a namespace-to-level map.
 * Reads: DEBUG, TRACE, INFO, WARN, ERROR, FATAL from process.env.
 * Later entries in the list override earlier ones for the same namespace.
 */
export function parseEnvLevels(): Omit<LoggerConfig, 'default'> {
  const result: Record<string, string> = {};

  for (const [envVar, level] of LEVEL_ENV_VARS) {
    const value = process.env[envVar];
    if (!value) continue;

    for (const pattern of value.split(',')) {
      const trimmed = pattern.trim();
      if (trimmed) {
        result[trimmed] = level;
      }
    }
  }

  return result;
}
