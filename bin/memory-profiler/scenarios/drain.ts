/**
 * Drain scenario
 *
 * Executes a 5-minute idle phase after the load phase, allowing the GROWI
 * server to release transient allocations (GC, connection pool shrink, etc.)
 * before the final heap snapshot is taken.
 *
 * The idle duration is configurable via the DRAIN_IDLE_SECONDS environment
 * variable to support shorter runs during development or CI.
 *
 * Design: Req 2.1 (3-phase ordering — Drain follows Load), Req 2.5
 * (reproducibility — const export is the single source of truth).
 */
import type { LoadDriver } from '../load-driver.ts';

/**
 * Duration of the drain idle phase in seconds.
 * Overridable via the DRAIN_IDLE_SECONDS environment variable.
 */
export const DRAIN_IDLE_SECONDS = Number(process.env.DRAIN_IDLE_SECONDS) || 300;

/**
 * Runs the drain idle phase.
 *
 * Accepts a LoadDriver for interface consistency with the scenario runner,
 * but does not invoke any load operations — the GROWI server is idle while
 * memory drains back toward baseline.
 *
 * @param _driver - LoadDriver interface (unused during idle phase).
 */
export async function runDrain(_driver: LoadDriver): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, DRAIN_IDLE_SECONDS * 1000);
  });
}
