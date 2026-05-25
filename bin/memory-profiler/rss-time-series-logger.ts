/**
 * RssTimeSeriesLogger
 *
 * Polls process.memoryUsage() from the GROWI server via CDP Runtime.evaluate
 * at a 1-second interval and appends the results as CSV rows to
 * `{outputDir}/rss-timeseries.csv`.
 *
 * CSV schema: timestamp,phase,rss,heap_used,heap_total,external
 *
 * If a CSV file already exists at the output path it is renamed to
 * `rss-timeseries.{ISO8601}.csv` before a new file is created (archive).
 *
 * Usage:
 *   const logger = createRssTimeSeriesLogger(outputDir, sendCommand);
 *   await logger.start('baseline');
 *   logger.mark('load');
 *   logger.mark('drain');
 *   await logger.stop();
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three profiling phases that can appear in the CSV phase column. */
export type Phase = 'baseline' | 'load' | 'drain';

/**
 * A function that sends a single CDP command and returns the response.
 * The concrete implementation wraps a WebSocket connection; in tests it is
 * a mock.
 */
export type CdpCommandSender = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

/** Deserialized result of `JSON.stringify(process.memoryUsage())` */
interface MemoryUsage {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

/** CDP Runtime.evaluate response shape for a returnByValue call. */
interface CdpEvaluateResult {
  result: { value: string };
}

export interface RssTimeSeriesLogger {
  /**
   * Starts polling process.memoryUsage() via CDP at a 1-second interval.
   * Creates (or archives-then-recreates) the output CSV with a header row.
   *
   * @param phase  Initial phase label written to the CSV until mark() is called.
   */
  start(phase: Phase): Promise<void>;

  /**
   * Changes the phase label written to subsequent CSV rows.
   * Can be called any number of times while the logger is running.
   */
  mark(phase: Phase): void;

  /**
   * Stops the polling interval and flushes any pending state.
   * Safe to call even when the logger has not been started.
   */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File name of the live CSV output. */
const CSV_FILENAME = 'rss-timeseries.csv';

/** Polling interval in milliseconds. */
const INTERVAL_MS = 1000;

/** CSV header row (written once at file creation). */
const CSV_HEADER = 'timestamp,phase,rss,heap_used,heap_total,external\n';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new RssTimeSeriesLogger instance.
 *
 * @param outputDir   Directory where `rss-timeseries.csv` is written.
 *                    Created recursively if it does not exist.
 * @param sendCommand CDP command sender (wraps the WebSocket connection).
 */
export function createRssTimeSeriesLogger(
  outputDir: string,
  sendCommand: CdpCommandSender,
): RssTimeSeriesLogger {
  let currentPhase: Phase = 'baseline';
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let outputPath: string;

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Ensures the output directory exists and returns the path to the CSV file.
   */
  function ensureOutputDir(): string {
    fs.mkdirSync(outputDir, { recursive: true });
    return path.join(outputDir, CSV_FILENAME);
  }

  /**
   * If a CSV file already exists at `filePath`, renames it to an archive name
   * that includes the current ISO8601 timestamp so it is never overwritten.
   * Example archive name: `rss-timeseries.2024-01-15T10:30:00.000Z.csv`
   */
  function archiveExisting(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    const iso = new Date().toISOString().replace(/:/g, '-');
    const archiveName = `rss-timeseries.${iso}.csv`;
    const archivePath = path.join(outputDir, archiveName);
    fs.renameSync(filePath, archivePath);
  }

  /**
   * Polls process.memoryUsage() via CDP and appends one CSV row.
   * Errors are swallowed so that a transient CDP failure does not crash the
   * interval loop.
   */
  async function pollAndAppend(): Promise<void> {
    let mem: MemoryUsage;
    try {
      const response = (await sendCommand('Runtime.evaluate', {
        expression: 'JSON.stringify(process.memoryUsage())',
        returnByValue: true,
      })) as CdpEvaluateResult;

      mem = JSON.parse(response.result.value) as MemoryUsage;
    } catch {
      // Silently skip this tick on CDP error; interval continues
      return;
    }

    const timestamp = new Date().toISOString();
    const row = `${timestamp},${currentPhase},${mem.rss},${mem.heapUsed},${mem.heapTotal},${mem.external}\n`;

    try {
      fs.appendFileSync(outputPath, row, 'utf8');
    } catch {
      // Silently skip on write error
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const start = (phase: Phase): Promise<void> => {
    currentPhase = phase;
    outputPath = ensureOutputDir();
    archiveExisting(outputPath);

    // Write header row to a fresh file
    fs.writeFileSync(outputPath, CSV_HEADER, 'utf8');

    // Start 1-second polling interval
    intervalHandle = setInterval(() => {
      // Fire-and-forget; errors are handled inside pollAndAppend
      void pollAndAppend();
    }, INTERVAL_MS);

    return Promise.resolve();
  };

  const mark = (phase: Phase): void => {
    currentPhase = phase;
  };

  const stop = (): Promise<void> => {
    if (intervalHandle != null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    return Promise.resolve();
  };

  return { start, mark, stop };
}
