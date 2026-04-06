import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoggerOptions, TransportSingleOptions } from 'pino';

interface NodeTransportOptions {
  transport?: TransportSingleOptions;
}

/**
 * Returns whether FORMAT_NODE_LOG env var indicates formatted output.
 * Formatted is the default (returns true when unset or truthy).
 * Returns false only when explicitly set to 'false' or '0'.
 */
function isFormattedOutputEnabled(): boolean {
  const val = process.env.FORMAT_NODE_LOG;
  if (val === undefined || val === null) return true;
  return val !== 'false' && val !== '0';
}

/**
 * Create pino transport/options for Node.js environment.
 * Development: bunyan-format custom transport with human-readable output.
 * Production: raw JSON by default; standard pino-pretty when FORMAT_NODE_LOG is truthy.
 */
export function createNodeTransportOptions(
  isProduction: boolean,
): NodeTransportOptions {
  if (!isProduction) {
    // Development: use bunyan-format custom transport (dev only)
    // Use path.join to resolve sibling module — avoids Vite's `new URL(…, import.meta.url)` asset transform
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const bunyanFormatPath = path.join(thisDir, 'dev', 'bunyan-format.js');
    return {
      transport: {
        target: bunyanFormatPath,
      },
    };
  }

  // Production: raw JSON unless FORMAT_NODE_LOG enables formatting
  if (!isFormattedOutputEnabled()) {
    return {};
  }

  return {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: true,
      },
    },
  };
}

/**
 * Create pino browser options.
 * Development: uses the resolved namespace level.
 * Production: defaults to 'error' level to minimize console noise.
 */
export function createBrowserOptions(
  isProduction: boolean,
): Partial<LoggerOptions> {
  const browserOptions: Partial<LoggerOptions> = {
    browser: {
      asObject: false,
    },
  };

  if (isProduction) {
    return { ...browserOptions, level: 'error' };
  }

  return browserOptions;
}
