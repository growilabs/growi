/**
 * runner-liveness.spec.ts
 *
 * Unit tests for the pure runner-liveness predicates.
 */

import { describe, expect, it } from 'vitest';

import {
  isBootstrapInFlight,
  isStaleBootstrapRunner,
} from '../runner-liveness';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const STALE_MS = 60_000;

/** A heartbeat written `ms` before NOW. */
const heartbeatAgedBy = (ms: number): Date => new Date(NOW.getTime() - ms);

describe('isBootstrapInFlight', () => {
  it.each([
    'running',
    'verifying',
  ] as const)('treats %s as in flight', (state) => {
    expect(isBootstrapInFlight(state)).toBe(true);
  });

  it.each([
    'pending',
    'done',
    'failed',
    'retrying',
    'escalated',
  ] as const)('treats %s as not in flight', (state) => {
    expect(isBootstrapInFlight(state)).toBe(false);
  });
});

describe('isStaleBootstrapRunner', () => {
  it('is false at the moment the heartbeat is written', () => {
    expect(
      isStaleBootstrapRunner({
        state: 'running',
        heartbeatAt: NOW,
        staleThresholdMs: STALE_MS,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('is false while the heartbeat age is still within the threshold', () => {
    expect(
      isStaleBootstrapRunner({
        state: 'running',
        heartbeatAt: heartbeatAgedBy(STALE_MS - 1),
        staleThresholdMs: STALE_MS,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('is false exactly at the threshold (the threshold is the last live moment)', () => {
    expect(
      isStaleBootstrapRunner({
        state: 'running',
        heartbeatAt: heartbeatAgedBy(STALE_MS),
        staleThresholdMs: STALE_MS,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('is true one millisecond past the threshold', () => {
    expect(
      isStaleBootstrapRunner({
        state: 'running',
        heartbeatAt: heartbeatAgedBy(STALE_MS + 1),
        staleThresholdMs: STALE_MS,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('is true for a verifying run whose heartbeat expired', () => {
    expect(
      isStaleBootstrapRunner({
        state: 'verifying',
        heartbeatAt: heartbeatAgedBy(STALE_MS * 100),
        staleThresholdMs: STALE_MS,
        now: NOW,
      }),
    ).toBe(true);
  });

  it.each([
    null,
    undefined,
  ])('is true for an in-flight run with %s heartbeat', (heartbeatAt) => {
    expect(
      isStaleBootstrapRunner({
        state: 'running',
        heartbeatAt,
        staleThresholdMs: STALE_MS,
        now: NOW,
      }),
    ).toBe(true);
  });

  it.each([
    'pending',
    'done',
    'failed',
    'retrying',
    'escalated',
  ] as const)('is false for the settled state %s no matter how old the heartbeat is', (state) => {
    expect(
      isStaleBootstrapRunner({
        state,
        heartbeatAt: heartbeatAgedBy(STALE_MS * 1000),
        staleThresholdMs: STALE_MS,
        now: NOW,
      }),
    ).toBe(false);
  });
});
