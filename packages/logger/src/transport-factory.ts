import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoggerOptions, TransportSingleOptions } from 'pino';

/**
 * Resolve a transport module to an absolute path.
 * pino loads transports in a worker thread that resolves a bare specifier
 * relative to the caller; when @growi/logger is bundled (e.g. Next.js SSR via
 * Turbopack) that resolution fails ("unable to determine transport target").
 * An absolute path is loaded directly by the worker and works in any context.
 *
 * Acquires `createRequire` via `process.getBuiltinModule` instead of a static
 * `import … from 'node:module'`: this module is also in the browser bundle
 * graph (the logger is universal) and `node:module` has no browser polyfill,
 * so a static import of it breaks the client build. `process.getBuiltinModule`
 * is not an import statement, so no `node:module` enters the browser graph.
 * This branch only runs server-side; falls back to the bare specifier if
 * resolution is unavailable (e.g. browser, where it is never called anyway).
 */
function resolveTransportTarget(specifier: string): string {
  try {
    const { createRequire } = process.getBuiltinModule('node:module');
    return createRequire(import.meta.url).resolve(specifier);
  } catch {
    return specifier;
  }
}

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
      target: resolveTransportTarget('pino-pretty'),
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
