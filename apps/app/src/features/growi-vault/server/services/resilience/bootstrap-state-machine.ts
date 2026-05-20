/**
 * BootstrapStateMachine — pure function state transition logic.
 *
 * No I/O, no side effects: input (state + event) → output (next state + side effect descriptors).
 * The runner is responsible for interpreting SideEffect values.
 */

export type BootstrapState =
  | 'pending' // before first run
  | 'running' // page stream in progress
  | 'verifying' // completeness check in progress
  | 'done' // verified complete
  | 'failed' // most recent attempt failed
  | 'retrying' // auto-retry waiting/running
  | 'escalated'; // max retries reached

export type TriggerSource = 'env-true' | 'env-force' | 'admin-ui';

export type BootstrapEvent =
  | { type: 'start'; triggerSource: TriggerSource }
  | { type: 'streamCompleted' }
  | { type: 'verifyPassed' }
  | { type: 'verifyFailed'; reason: string }
  | { type: 'throw'; reason: string }
  | { type: 'staleRunningDetected' }
  | { type: 'retryScheduled'; attemptNo: number }
  | { type: 'retryExhausted' }
  | { type: 'forceOverride' };

/** Descriptors that the runner interprets; never executed inside this module. */
export type SideEffect =
  | { kind: 'emitResetAll' }
  | { kind: 'resetCursor' }
  | { kind: 'logWarning'; message: string };

export type TransitionResult =
  | { ok: true; next: BootstrapState; sideEffects: readonly SideEffect[] }
  | { ok: false; reason: string };

// Convenience constructors
const ok = (
  next: BootstrapState,
  sideEffects: readonly SideEffect[] = [],
): TransitionResult => ({
  ok: true,
  next,
  sideEffects,
});

const invalid = (reason: string): TransitionResult => ({ ok: false, reason });

const EMIT_RESET_ALL: readonly SideEffect[] = [{ kind: 'emitResetAll' }];
const RESET_CURSOR: readonly SideEffect[] = [{ kind: 'resetCursor' }];

/**
 * Pure state transition function.
 *
 * Implements the full transition table for BootstrapStateMachine.
 * Invalid (state × event) pairs return { ok: false } instead of throwing.
 */
export const transition = (
  current: BootstrapState,
  event: BootstrapEvent,
): TransitionResult => {
  // forceOverride is valid from ANY state — handle it first
  if (event.type === 'forceOverride') {
    return ok('running', EMIT_RESET_ALL);
  }

  switch (current) {
    case 'pending':
      switch (event.type) {
        case 'start':
          return ok('running');
        default:
          return invalid(
            `No transition from 'pending' on event '${event.type}'`,
          );
      }

    case 'running':
      switch (event.type) {
        case 'streamCompleted':
          return ok('verifying');
        case 'throw':
          return ok('failed');
        case 'staleRunningDetected':
          return ok('retrying');
        // Double-start prevention: running + start is invalid
        case 'start':
          return invalid(
            "Cannot 'start' while already 'running' (double-start prevention)",
          );
        default:
          return invalid(
            `No transition from 'running' on event '${event.type}'`,
          );
      }

    case 'verifying':
      switch (event.type) {
        case 'verifyPassed':
          return ok('done', RESET_CURSOR);
        case 'verifyFailed':
          return ok('failed');
        default:
          return invalid(
            `No transition from 'verifying' on event '${event.type}'`,
          );
      }

    case 'done':
      switch (event.type) {
        // done→running ONLY via forceOverride (handled above); normal start is invalid
        case 'start':
          return invalid(
            "Cannot 'start' from 'done' — use 'forceOverride' to restart",
          );
        default:
          return invalid(`No transition from 'done' on event '${event.type}'`);
      }

    case 'failed':
      switch (event.type) {
        case 'retryScheduled':
          return ok('retrying');
        default:
          return invalid(
            `No transition from 'failed' on event '${event.type}'`,
          );
      }

    case 'retrying':
      switch (event.type) {
        case 'start':
          return ok('running');
        case 'retryExhausted':
          return ok('escalated');
        default:
          return invalid(
            `No transition from 'retrying' on event '${event.type}'`,
          );
      }

    case 'escalated':
      // forceOverride already handled above; all other events invalid from escalated
      switch (event.type) {
        default:
          return invalid(
            `No transition from 'escalated' on event '${event.type}'`,
          );
      }
  }
};
