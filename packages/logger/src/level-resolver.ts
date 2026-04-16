import { minimatch } from 'minimatch';

import type { LoggerConfig } from './types';

/**
 * Resolve the log level for a namespace.
 * Priority: env var match > config pattern match > config default.
 */
export function resolveLevel(
  namespace: string,
  config: LoggerConfig,
  envOverrides: Omit<LoggerConfig, 'default'>,
): string {
  // 1. Check env overrides first (highest priority)
  for (const [pattern, level] of Object.entries(envOverrides)) {
    if (matchesPattern(namespace, pattern)) {
      return level;
    }
  }

  // 2. Check config patterns (excluding the 'default' key)
  for (const [pattern, level] of Object.entries(config)) {
    if (pattern === 'default') continue;
    if (matchesPattern(namespace, pattern)) {
      return level;
    }
  }

  // 3. Fall back to config default
  return config.default;
}

function matchesPattern(namespace: string, pattern: string): boolean {
  // Exact match
  if (namespace === pattern) return true;
  // Glob match using minimatch
  return minimatch(namespace, pattern);
}
