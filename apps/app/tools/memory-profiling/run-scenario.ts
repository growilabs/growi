/**
 * ScenarioRunner
 *
 * Orchestrates the 3-phase memory profiling session:
 *   Baseline → Snapshot A → Load → Snapshot B → Drain → Snapshot C
 *
 * Exit codes when run as a CLI entry point:
 *   0 — success
 *   1 — snapshot acquisition failure
 *   2 — CDP connection failure
 *
 * Usage:
 *   tsx tools/memory-profiling/run-scenario.ts \
 *     --baseUrl http://localhost:3000 \
 *     --inspector http://127.0.0.1:9229 \
 *     [--outputDir tmp/memory-leak-investigation/] \
 *     [--idleSeconds 300]
 */

import * as path from 'node:path';

import { createCdpSnapshotClient } from './cdp-snapshot-client';
import { createRssCommandSender } from './lib/rss-command-sender';
import { createLoadDriver } from './load-driver';
import { createRssTimeSeriesLogger } from './rss-time-series-logger';
import { runBaseline } from './scenarios/baseline';
import { runDrain } from './scenarios/drain';
import { runLoad } from './scenarios/load';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadOpCounts {
  readonly pageCreate: number;
  readonly pageEdit: number;
  readonly pageGet: number;
  readonly pageList: number;
  readonly pageSearch: number;
  readonly yjsSessionsCleanClose: number;
  readonly yjsSessionsAbort: number;
}

export interface ScenarioRunnerOptions {
  /** CDP inspector endpoint, e.g. "http://127.0.0.1:9229" */
  readonly inspectorUrl: string;
  /** Output directory for snapshots and CSV, e.g. "tmp/memory-leak-investigation/" */
  readonly outputDir: string;
  /** GROWI server base URL, e.g. "http://localhost:3000" */
  readonly baseUrl: string;
  /** Idle duration in seconds (used for baseline / drain phases). Default 300. */
  readonly idleSeconds: number;
  /** Per-operation counts for the load phase. */
  readonly loadOpCounts: LoadOpCounts;
}

/**
 * Tagged error with an exit code so the CLI entry point can distinguish
 * connection failures (2) from snapshot failures (1).
 */
export class ScenarioRunnerError extends Error {
  readonly exitCode: 1 | 2;

  constructor(message: string, exitCode: 1 | 2, cause?: unknown) {
    super(message, { cause });
    this.name = 'ScenarioRunnerError';
    this.exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------
// Core orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs the full 3-phase memory profiling scenario.
 *
 * Orchestration sequence:
 * 1. Connect CDP client (throws ScenarioRunnerError exitCode=2 on failure)
 * 2. Start RSS logger
 * 3. Mark 'baseline', run baseline phase
 * 4. Take snapshot A (throws ScenarioRunnerError exitCode=1 on failure)
 * 5. Mark 'load', run load phase
 * 6. Take snapshot B (throws ScenarioRunnerError exitCode=1 on failure)
 * 7. Mark 'drain', run drain phase
 * 8. Take snapshot C (throws ScenarioRunnerError exitCode=1 on failure)
 * 9. Stop RSS logger
 * 10. Close CDP client
 * 11. Print summary to stdout
 */
export async function runScenario(opts: ScenarioRunnerOptions): Promise<void> {
  const { baseUrl, inspectorUrl, outputDir } = opts;

  // Resolve output directory to ensure consistent paths (Req 1.4)
  const resolvedOutputDir = path.resolve(outputDir);

  const cdpClient = createCdpSnapshotClient();
  const driver = createLoadDriver(baseUrl);

  // -------------------------------------------------------------------------
  // Step 1: Connect CDP client
  // Exit code 2 on connection failure
  // -------------------------------------------------------------------------
  try {
    await cdpClient.connect(inspectorUrl);
  } catch (err) {
    throw new ScenarioRunnerError(
      `Failed to connect to CDP inspector at ${inspectorUrl}: ${String(err)}`,
      2,
      err,
    );
  }

  // biome-ignore lint/suspicious/noConsole: intentional CLI progress output
  console.log(`[run-scenario] Connected to CDP inspector at ${inspectorUrl}`);

  // -------------------------------------------------------------------------
  // Build a sendCommand for the RSS logger.
  // A separate connection is used so RSS polling does not interfere with
  // HeapProfiler commands on the snapshot client's connection.
  // -------------------------------------------------------------------------
  const rssCommandSender = await createRssCommandSender(inspectorUrl);
  const logger = createRssTimeSeriesLogger(resolvedOutputDir, rssCommandSender);

  // -------------------------------------------------------------------------
  // Step 2: Start RSS logger in baseline phase
  // -------------------------------------------------------------------------
  await logger.start('baseline');

  // -------------------------------------------------------------------------
  // Snapshot helper: wraps takeSnapshot with exit-code-1 error translation
  // -------------------------------------------------------------------------
  const takeSnapshotSafe = async (label: string): Promise<void> => {
    const outputPath = path.join(resolvedOutputDir, `${label}.heapsnapshot`);
    try {
      await cdpClient.takeSnapshot(outputPath);
    } catch (err) {
      // Ensure logger is stopped before re-throwing
      await logger.stop().catch(() => undefined);
      throw new ScenarioRunnerError(
        `Snapshot ${label} failed: ${String(err)}`,
        1,
        err,
      );
    }
    // biome-ignore lint/suspicious/noConsole: intentional CLI progress output
    console.log(`[run-scenario] Snapshot written: ${outputPath}`);
  };

  try {
    // -----------------------------------------------------------------------
    // Step 3: Baseline phase (Req 2.1)
    // -----------------------------------------------------------------------
    // biome-ignore lint/suspicious/noConsole: intentional CLI progress output
    console.log('[run-scenario] Phase: baseline');
    await runBaseline(driver);

    // -----------------------------------------------------------------------
    // Step 4: Snapshot A — Baseline boundary (Req 2.4)
    // -----------------------------------------------------------------------
    await takeSnapshotSafe('snapshot-a');

    // -----------------------------------------------------------------------
    // Step 5: Load phase (Req 2.1)
    // -----------------------------------------------------------------------
    logger.mark('load');
    // biome-ignore lint/suspicious/noConsole: intentional CLI progress output
    console.log('[run-scenario] Phase: load');
    await runLoad(driver);

    // -----------------------------------------------------------------------
    // Step 6: Snapshot B — Load boundary (Req 2.4)
    // -----------------------------------------------------------------------
    await takeSnapshotSafe('snapshot-b');

    // -----------------------------------------------------------------------
    // Step 7: Drain phase (Req 2.1)
    // -----------------------------------------------------------------------
    logger.mark('drain');
    // biome-ignore lint/suspicious/noConsole: intentional CLI progress output
    console.log('[run-scenario] Phase: drain');
    await runDrain(driver);

    // -----------------------------------------------------------------------
    // Step 8: Snapshot C — Drain boundary (Req 2.4)
    // -----------------------------------------------------------------------
    await takeSnapshotSafe('snapshot-c');

    // -----------------------------------------------------------------------
    // Step 9: Stop RSS logger
    // -----------------------------------------------------------------------
    await logger.stop();

    // -----------------------------------------------------------------------
    // Step 10: Close CDP client
    // -----------------------------------------------------------------------
    await cdpClient.close();

    // -----------------------------------------------------------------------
    // Step 11: Print summary (Req 1.4)
    // -----------------------------------------------------------------------
    printSummary(resolvedOutputDir);
  } catch (err) {
    // Cleanup on unexpected errors (snapshot errors are already handled in
    // takeSnapshotSafe before re-throwing as ScenarioRunnerError)
    await logger.stop().catch(() => undefined);
    await cdpClient.close().catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Summary output
// ---------------------------------------------------------------------------

function printSummary(outputDir: string): void {
  // biome-ignore lint/suspicious/noConsole: intentional CLI summary output
  console.log('\n========== Memory Profiling Session Summary ==========');
  // biome-ignore lint/suspicious/noConsole: intentional CLI summary output
  console.log(`Output directory: ${outputDir}`);
  // biome-ignore lint/suspicious/noConsole: intentional CLI summary output
  console.log('Snapshots:');
  // biome-ignore lint/suspicious/noConsole: intentional CLI summary output
  console.log(
    `  A (baseline boundary): ${path.join(outputDir, 'snapshot-a.heapsnapshot')}`,
  );
  // biome-ignore lint/suspicious/noConsole: intentional CLI summary output
  console.log(
    `  B (load boundary):     ${path.join(outputDir, 'snapshot-b.heapsnapshot')}`,
  );
  // biome-ignore lint/suspicious/noConsole: intentional CLI summary output
  console.log(
    `  C (drain boundary):    ${path.join(outputDir, 'snapshot-c.heapsnapshot')}`,
  );
  // biome-ignore lint/suspicious/noConsole: intentional CLI summary output
  console.log(
    `RSS time series:         ${path.join(outputDir, 'rss-timeseries.csv')}`,
  );
  // biome-ignore lint/suspicious/noConsole: intentional CLI summary output
  console.log('======================================================\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Parses CLI arguments from process.argv.
 * Supports:
 *   --baseUrl <url>        (required)
 *   --inspector <url>      (required)
 *   --outputDir <path>     (default: tmp/memory-leak-investigation/)
 *   --idleSeconds <n>      (default: 300)
 */
function parseArgs(): ScenarioRunnerOptions {
  const args = process.argv.slice(2);

  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const baseUrl = get('--baseUrl') ?? process.env.GROWI_BASE_URL;
  const inspectorUrl = get('--inspector') ?? process.env.CDP_INSPECTOR_URL;
  const outputDir =
    get('--outputDir') ??
    process.env.MEMORY_PROFILING_OUTPUT_DIR ??
    'tmp/memory-leak-investigation/';
  const idleSeconds = Number(
    get('--idleSeconds') ?? process.env.IDLE_SECONDS ?? 300,
  );

  if (baseUrl == null || baseUrl === '') {
    // biome-ignore lint/suspicious/noConsole: CLI error message
    console.error(
      'Error: --baseUrl is required (or set GROWI_BASE_URL env var)',
    );
    process.exit(2);
  }

  if (inspectorUrl == null || inspectorUrl === '') {
    // biome-ignore lint/suspicious/noConsole: CLI error message
    console.error(
      'Error: --inspector is required (or set CDP_INSPECTOR_URL env var)',
    );
    process.exit(2);
  }

  return {
    baseUrl,
    inspectorUrl,
    outputDir,
    idleSeconds,
    loadOpCounts: {
      pageCreate: Number(process.env.LOAD_PAGE_CREATE) || 20,
      pageEdit: Number(process.env.LOAD_PAGE_EDIT) || 20,
      pageGet: Number(process.env.LOAD_PAGE_GET) || 50,
      pageList: Number(process.env.LOAD_PAGE_LIST) || 10,
      pageSearch: Number(process.env.LOAD_PAGE_SEARCH) || 30,
      yjsSessionsCleanClose: Number(process.env.LOAD_YJS_CLEAN_CLOSE) || 10,
      yjsSessionsAbort: Number(process.env.LOAD_YJS_ABORT) || 10,
    },
  };
}

/**
 * CLI main: called when run directly via tsx / ts-node.
 */
async function main(): Promise<void> {
  const opts = parseArgs();

  // biome-ignore lint/suspicious/noConsole: CLI entry point output
  console.log('[run-scenario] Starting memory profiling session...');
  // biome-ignore lint/suspicious/noConsole: CLI entry point output
  console.log(`  Base URL:     ${opts.baseUrl}`);
  // biome-ignore lint/suspicious/noConsole: CLI entry point output
  console.log(`  Inspector:    ${opts.inspectorUrl}`);
  // biome-ignore lint/suspicious/noConsole: CLI entry point output
  console.log(`  Output dir:   ${opts.outputDir}`);
  // biome-ignore lint/suspicious/noConsole: CLI entry point output
  console.log(`  Idle seconds: ${opts.idleSeconds}`);

  try {
    await runScenario(opts);
    process.exit(0);
  } catch (err) {
    if (err instanceof ScenarioRunnerError) {
      // biome-ignore lint/suspicious/noConsole: CLI error output
      console.error(
        `[run-scenario] Error (exit ${err.exitCode}): ${err.message}`,
      );
      process.exit(err.exitCode);
    }
    // biome-ignore lint/suspicious/noConsole: CLI unexpected error
    console.error('[run-scenario] Unexpected error:', err);
    process.exit(1);
  }
}

// Run main only when executed as CLI entry point
if (
  process.argv[1] != null &&
  (process.argv[1].endsWith('run-scenario.ts') ||
    process.argv[1].endsWith('run-scenario.js'))
) {
  void main();
}
