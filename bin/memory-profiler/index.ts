// Public barrel for memory-profiler module.
// Exposes only the stable contract per design.md "Barrel Exposure Rules".
// Internal symbols (factories, scenario `run*` functions, `LOAD_*` constants,
// lib/* helpers) MUST NOT be re-exported here.

export type { LoadDriver } from './load-driver.ts';
export type { LoadOpCounts, ScenarioRunnerOptions } from './run-scenario.ts';
export { runScenario, ScenarioRunnerError } from './run-scenario.ts';
