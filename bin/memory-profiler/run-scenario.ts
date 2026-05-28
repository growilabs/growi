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
 *   tsx bin/memory-profiler/run-scenario.ts \
 *     --baseUrl http://localhost:3000 \
 *     --inspector http://127.0.0.1:9229 \
 *     [--outputDir tmp/memory-profiler/] \
 *     [--idleSeconds 300]
 */

import * as path from 'node:path';

import { createCdpSnapshotClient } from './cdp-snapshot-client';
import { createLoadDriver } from './load-driver';
import { createRssTimeSeriesLogger } from './rss-time-series-logger';
import { runBaseline, runDrain, runLoad } from './scenarios';

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
  /** Output directory for snapshots and CSV, e.g. "tmp/memory-profiler/" */
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

  console.log(`[run-scenario] Connected to CDP inspector at ${inspectorUrl}`);

  // -------------------------------------------------------------------------
  // Step 1.5: Establish admin session via installer API
  // -------------------------------------------------------------------------
  try {
    await driver.initInstaller();
    console.log('[run-scenario] Admin session established via installer');
  } catch (err) {
    console.warn(
      '[run-scenario] initInstaller failed (GROWI may already be installed):',
      String(err),
    );
  }

  // -------------------------------------------------------------------------
  // Build a sendCommand for the RSS logger.
  // Share the cdpClient's WebSocket connection — Node.js inspector allows
  // only one WebSocket client per target, so a second connection would kick
  // out the snapshot client and cause 0-byte snapshots.
  // -------------------------------------------------------------------------
  const logger = createRssTimeSeriesLogger(
    resolvedOutputDir,
    (method, params) => cdpClient.sendCommand(method, params),
  );

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
    console.log(`[run-scenario] Snapshot written: ${outputPath}`);
  };

  try {
    // -----------------------------------------------------------------------
    // Step 3: Baseline phase (Req 2.1)
    // -----------------------------------------------------------------------
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
  console.log('\n========== Memory Profiling Session Summary ==========');
  console.log(`Output directory: ${outputDir}`);
  console.log('Snapshots:');
  console.log(
    `  A (baseline boundary): ${path.join(outputDir, 'snapshot-a.heapsnapshot')}`,
  );
  console.log(
    `  B (load boundary):     ${path.join(outputDir, 'snapshot-b.heapsnapshot')}`,
  );
  console.log(
    `  C (drain boundary):    ${path.join(outputDir, 'snapshot-c.heapsnapshot')}`,
  );
  console.log(
    `RSS time series:         ${path.join(outputDir, 'rss-timeseries.csv')}`,
  );
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
 *   --outputDir <path>     (default: tmp/memory-profiler/)
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
    'tmp/memory-profiler/';
  const idleSeconds = Number(
    get('--idleSeconds') ?? process.env.IDLE_SECONDS ?? 300,
  );

  if (baseUrl == null || baseUrl === '') {
    console.error(
      'Error: --baseUrl is required (or set GROWI_BASE_URL env var)',
    );
    process.exit(2);
  }

  if (inspectorUrl == null || inspectorUrl === '') {
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

  console.log('[run-scenario] Starting memory profiling session...');
  console.log(`  Base URL:     ${opts.baseUrl}`);
  console.log(`  Inspector:    ${opts.inspectorUrl}`);
  console.log(`  Output dir:   ${opts.outputDir}`);
  console.log(`  Idle seconds: ${opts.idleSeconds}`);

  try {
    await runScenario(opts);
    process.exit(0);
  } catch (err) {
    if (err instanceof ScenarioRunnerError) {
      console.error(
        `[run-scenario] Error (exit ${err.exitCode}): ${err.message}`,
      );
      process.exit(err.exitCode);
    }
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
