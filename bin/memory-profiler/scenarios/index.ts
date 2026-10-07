/**
 * Scenarios sub-barrel
 *
 * Public surface for the memory-profiler scenarios module.  Exposes the
 * three phase functions (runBaseline / runLoad / runDrain) and the LOAD_*
 * op-count constants that act as the single source of truth for
 * reproducibility (Req 1.4, 8.4 — Barrel Exposure Rules).
 *
 * Idle-phase constants (BASELINE_IDLE_SECONDS / DRAIN_IDLE_SECONDS) are
 * intentionally not re-exported: they are internal to baseline.ts and
 * drain.ts and are consumed only inside those modules.
 */

export { runBaseline } from './baseline.ts';
export { runDrain } from './drain.ts';
export {
  LOAD_PAGE_CREATE,
  LOAD_PAGE_EDIT,
  LOAD_PAGE_GET,
  LOAD_PAGE_LIST,
  LOAD_PAGE_SEARCH,
  LOAD_YJS_ABORT,
  LOAD_YJS_CLEAN_CLOSE,
  runLoad,
} from './load.ts';
