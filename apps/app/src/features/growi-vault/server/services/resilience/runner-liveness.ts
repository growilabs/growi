/**
 * runner-liveness.ts — pure predicates about whether an in-flight bootstrap
 * still has a live owner.
 *
 * No I/O: callers pass the persisted state plus the heartbeat timestamp they
 * already read. Both the startup normalization (features/growi-vault/server/
 * index.ts) and the status API (bootstrap-runner getStatus) decide liveness
 * from this single rule, so the two can never disagree about what "abandoned"
 * means.
 */

import type { BootstrapState } from './bootstrap-state-machine';

/**
 * States that assert a bootstrap run is in flight.
 *
 * Nothing moves them except the process that owns the run, so they are only
 * trustworthy while that process keeps refreshing the heartbeat.
 */
const IN_FLIGHT_STATES: readonly BootstrapState[] = ['running', 'verifying'];

/** True when the state claims a run is in flight ('running' / 'verifying'). */
export const isBootstrapInFlight = (state: BootstrapState): boolean =>
  IN_FLIGHT_STATES.includes(state);

export interface RunnerLivenessInput {
  readonly state: BootstrapState;
  readonly heartbeatAt: Date | null | undefined;
  /** Age beyond which a heartbeat no longer proves a live runner. */
  readonly staleThresholdMs: number;
  /** Injected by tests; defaults to the current time. */
  readonly now?: Date;
}

/**
 * True when the persisted state claims a run is in flight but no process has
 * refreshed the heartbeat within the threshold — the run was abandoned (crash
 * or restart) and will never progress on its own.
 *
 * A missing heartbeat on an in-flight state counts as abandoned: the runner
 * writes one before it starts streaming, so its absence means no live owner.
 * The instance id deliberately plays no part — it is written at the start of
 * every run and therefore survives a crash, which is exactly why an id-based
 * check strands an abandoned run forever.
 */
export const isStaleBootstrapRunner = (input: RunnerLivenessInput): boolean => {
  const { state, heartbeatAt, staleThresholdMs, now = new Date() } = input;

  if (!isBootstrapInFlight(state)) return false;
  if (heartbeatAt == null) return true;

  return heartbeatAt.getTime() < now.getTime() - staleThresholdMs;
};
