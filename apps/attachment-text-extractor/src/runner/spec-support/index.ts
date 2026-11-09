// Test-only helpers for the runner and child integration tests. Never import from production code.
export { type HostRun, startHost } from './host';
export {
  childPids,
  hasEnded,
  killStrayChildren,
  openFdCount,
  processState,
  procText,
  waitForOnlyChild,
  waitUntil,
} from './processes';
export {
  defaultSettings,
  RUN_GUARD_MS,
  runnerOptions,
  SERVICE_TOKEN_NAME,
  settle,
  within,
} from './runner-options';
export {
  MISSING_CHILD,
  rawResultInput,
  SILENT_CHILD,
  STAND_IN_CHILD,
  standInInput,
  TS_NODE_ARGS,
  tsEntry,
  WATCHED_BUSY_CHILD,
} from './stand-in';
