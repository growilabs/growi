/**
 * Baseline scenario
 *
 * Executes a 5-minute idle phase before load begins, allowing the GROWI server
 * to reach a steady-state memory baseline.  The idle duration is configurable
 * via the BASELINE_IDLE_SECONDS environment variable to support shorter runs
 * during development or CI.
 *
 * Design: Req 2.1 (3-phase ordering), Req 2.5 (reproducibility — const export
 * is the single source of truth for the idle duration).
 */
import type { LoadDriver } from '../load-driver.ts';

/**
 * Duration of the baseline idle phase in seconds.
 * Overridable via the BASELINE_IDLE_SECONDS environment variable.
 */
export const BASELINE_IDLE_SECONDS =
  Number(process.env.BASELINE_IDLE_SECONDS) || 300;

/**
 * Runs the baseline idle phase.
 *
 * Accepts a LoadDriver for interface consistency with the scenario runner,
 * but does not invoke any load operations — the GROWI server remains idle.
 *
 * @param _driver - LoadDriver interface (unused during idle phase).
 */
export async function runBaseline(_driver: LoadDriver): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, BASELINE_IDLE_SECONDS * 1000);
  });
}
