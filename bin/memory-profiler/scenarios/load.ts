/**
 * Load scenario
 *
 * Generates mixed load against a GROWI server by sequentially executing page
 * CRUD, page read/list/search, and y-websocket session operations.  The op
 * counts are exported as named constants so the ScenarioRunner and any
 * caller can reference the same single source of truth (Req 2.5 —
 * reproducibility).
 *
 * Default counts follow the design spec (tasks.md Load op counts section):
 *   pageCreate: 20, pageEdit: 20, pageGet: 50, pageList: 10, pageSearch: 30,
 *   yjsSessionsCleanClose: 10, yjsSessionsAbort: 10
 *
 * Each count is overridable via environment variables to support shorter runs
 * during development.
 *
 * Design: Req 2.2 (mixed load), Req 2.5 (reproducibility), Req 7.1 (search /
 * get / list path coverage).
 */
import type { LoadDriver } from '../load-driver.ts';

// ---------------------------------------------------------------------------
// Op counts — source of truth for reproducibility (Req 2.5)
// ---------------------------------------------------------------------------

/** Number of page-create operations. */
export const LOAD_PAGE_CREATE = Number(process.env.LOAD_PAGE_CREATE) || 20;

/** Number of page-edit operations. */
export const LOAD_PAGE_EDIT = Number(process.env.LOAD_PAGE_EDIT) || 20;

/** Number of page-get (markdown render) operations. */
export const LOAD_PAGE_GET = Number(process.env.LOAD_PAGE_GET) || 50;

/** Number of page-list (page tree walk) operations. */
export const LOAD_PAGE_LIST = Number(process.env.LOAD_PAGE_LIST) || 10;

/** Number of full-text search operations. */
export const LOAD_PAGE_SEARCH = Number(process.env.LOAD_PAGE_SEARCH) || 30;

/** Number of y-websocket sessions opened and closed cleanly. */
export const LOAD_YJS_CLEAN_CLOSE =
  Number(process.env.LOAD_YJS_CLEAN_CLOSE) || 10;

/** Number of y-websocket sessions opened and then aborted. */
export const LOAD_YJS_ABORT = Number(process.env.LOAD_YJS_ABORT) || 10;

// ---------------------------------------------------------------------------
// Scenario function
// ---------------------------------------------------------------------------

/**
 * Runs the load phase against the given driver.
 *
 * Operations are executed sequentially in a fixed order to ensure consistent,
 * reproducible results across runs (Req 2.5).  The LoadDriver implementation
 * is injected by the ScenarioRunner (wired in task 4.2) so this module has
 * no dependency on the concrete driver implementation.
 *
 * @param driver - LoadDriver interface to invoke for each operation.
 */
export async function runLoad(driver: LoadDriver): Promise<void> {
  await driver.pageCreate(LOAD_PAGE_CREATE);
  await driver.pageEdit(LOAD_PAGE_EDIT);
  await driver.pageGet(LOAD_PAGE_GET);
  await driver.pageList(LOAD_PAGE_LIST);
  await driver.pageSearch(LOAD_PAGE_SEARCH);
  await driver.yjsSessionCleanClose(LOAD_YJS_CLEAN_CLOSE);
  await driver.yjsSessionAbort(LOAD_YJS_ABORT);
}
