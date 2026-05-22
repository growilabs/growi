import * as fs from 'node:fs';
import * as path from 'node:path';
import * as v8 from 'node:v8';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('heap-snapshot-handler');

const DEFAULT_OUTPUT_DIR = 'tmp/memory-leak-investigation/snapshots';

/**
 * Registers a SIGUSR2 signal handler that writes a heap snapshot to disk.
 *
 * Only registers the handler when `MEMORY_PROFILING_ENABLED` env var is truthy.
 * In production (env var not set), this function is a no-op with zero impact.
 *
 * Output path is controlled by `MEMORY_PROFILING_OUTPUT_DIR` env var
 * (default: `tmp/memory-leak-investigation/snapshots/`).
 * File name format: `signal-{ISO8601-timestamp}.heapsnapshot`
 *
 * Exceptions inside the signal handler are caught and logged via growi-logger;
 * the server process is never terminated by this handler (Req 1.5).
 */
export function registerHeapSnapshotSignalHandler(): void {
  // Guard: only register when MEMORY_PROFILING_ENABLED is truthy
  if (!process.env.MEMORY_PROFILING_ENABLED) {
    return;
  }

  process.on('SIGUSR2', () => {
    try {
      const outputDir =
        process.env.MEMORY_PROFILING_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR;

      // Create output directory recursively if it does not exist (Req 1.4)
      fs.mkdirSync(outputDir, { recursive: true });

      // Build timestamp-based filename using ISO8601 with colons replaced by dashes
      // for filesystem compatibility
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const filename = `signal-${timestamp}.heapsnapshot`;
      const outputPath = path.join(outputDir, filename);

      v8.writeHeapSnapshot(outputPath);
      logger.info({ outputPath }, 'Heap snapshot written via SIGUSR2');
    } catch (err) {
      // Catch all exceptions — the server process must NOT be stopped (Req 1.5)
      logger.error({ err }, 'Failed to write heap snapshot via SIGUSR2');
    }
  });
}
