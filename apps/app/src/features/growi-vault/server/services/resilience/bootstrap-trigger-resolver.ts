/**
 * BootstrapTriggerResolver — pure function: env + state → action.
 *
 * No I/O, no side effects. The runner interprets the returned BootstrapAction.
 *
 * Resolution table:
 * | envValue | currentState              | retryAllowed | isStaleRunning | result             |
 * |----------|---------------------------|--------------|----------------|--------------------|
 * | 'force'  | ANY                       | ANY          | ANY            | forceWipe          |
 * | 'false'  | ANY                       | ANY          | ANY            | skip               |
 * | 'unknown'| ANY                       | ANY          | ANY            | skip               |
 * | 'true'   | 'done'                    | ANY          | ANY            | skip               |
 * | 'true'   | 'pending'                 | ANY          | ANY            | startNew           |
 * | 'true'   | 'running'                 | ANY          | true           | resumeFromCursor   |
 * | 'true'   | 'running'                 | ANY          | false          | skip               |
 * | 'true'   | 'failed'                  | true         | ANY            | resumeFromCursor   |
 * | 'true'   | 'failed'                  | false        | ANY            | skip               |
 * | 'true'   | 'retrying'                | true         | ANY            | resumeFromCursor   |
 * | 'true'   | 'retrying'                | false        | ANY            | skip               |
 * | 'true'   | 'escalated'               | true         | ANY            | resumeFromCursor   |
 * | 'true'   | 'escalated'               | false        | ANY            | skip               |
 * | 'true'   | 'verifying'               | ANY          | ANY            | skip               |
 */

import type { BootstrapState } from './bootstrap-state-machine';

export type { TriggerSource } from './bootstrap-state-machine';

export type BootstrapEnvValue = 'true' | 'false' | 'force' | 'unknown';

export type BootstrapAction =
  | { kind: 'skip' }
  | { kind: 'startNew'; triggerSource: 'env-true' }
  | { kind: 'resumeFromCursor'; triggerSource: 'env-true' }
  | { kind: 'forceWipe'; triggerSource: 'env-force' };

const SKIP: BootstrapAction = { kind: 'skip' };
const START_NEW: BootstrapAction = {
  kind: 'startNew',
  triggerSource: 'env-true',
};
const RESUME_FROM_CURSOR: BootstrapAction = {
  kind: 'resumeFromCursor',
  triggerSource: 'env-true',
};
const FORCE_WIPE: BootstrapAction = {
  kind: 'forceWipe',
  triggerSource: 'env-force',
};

/**
 * Pure resolver: maps (envValue, currentState, retryAllowed, isStaleRunning) → BootstrapAction.
 *
 * Preconditions:
 * - envValue has been normalized by configManager to one of the four known values.
 * - currentState reflects the persisted bootstrap state.
 *
 * Postconditions:
 * - Returns a single action descriptor; the runner is responsible for execution.
 */
export const resolveAction = (
  envValue: BootstrapEnvValue,
  currentState: BootstrapState,
  retryAllowed: boolean,
  isStaleRunning: boolean,
): BootstrapAction => {
  // env=force: always wipe regardless of state
  if (envValue === 'force') {
    return FORCE_WIPE;
  }

  // env=false or unknown: never do anything
  if (envValue === 'false' || envValue === 'unknown') {
    return SKIP;
  }

  // env=true: state-driven resolution
  switch (currentState) {
    case 'done':
      // Already complete — nothing to do
      return SKIP;

    case 'pending':
      // No prior run — start fresh
      return START_NEW;

    case 'running':
      // Actively running: only resume if the heartbeat is stale (crashed runner)
      return isStaleRunning ? RESUME_FROM_CURSOR : SKIP;

    case 'failed':
    case 'retrying':
    case 'escalated':
      // Resume only when the retry budget allows it
      return retryAllowed ? RESUME_FROM_CURSOR : SKIP;

    case 'verifying':
      // In-progress completeness check — don't interrupt
      return SKIP;
  }
};
