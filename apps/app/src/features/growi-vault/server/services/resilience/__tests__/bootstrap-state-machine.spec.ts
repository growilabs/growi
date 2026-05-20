import { describe, expect, it } from 'vitest';

import {
  type BootstrapEvent,
  type BootstrapState,
  type SideEffect,
  transition,
} from '../bootstrap-state-machine';

// Helper to assert a valid transition
function assertValid(
  current: BootstrapState,
  event: BootstrapEvent,
  expectedNext: BootstrapState,
  expectedEffects?: SideEffect['kind'][],
) {
  const result = transition(current, event);
  expect(result.ok, `${current} + ${event.type} should be valid`).toBe(true);
  if (!result.ok) return; // type narrowing
  expect(result.next).toBe(expectedNext);
  if (expectedEffects !== undefined) {
    expect(result.sideEffects.map((e) => e.kind)).toEqual(expectedEffects);
  }
}

// Helper to assert an invalid transition
function assertInvalid(current: BootstrapState, event: BootstrapEvent) {
  const result = transition(current, event);
  expect(result.ok, `${current} + ${event.type} should be invalid`).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBeTruthy();
  }
}

describe('transition — valid transitions from the table', () => {
  it('pending + start → running (no side effects)', () => {
    assertValid(
      'pending',
      { type: 'start', triggerSource: 'env-true' },
      'running',
      [],
    );
  });

  it('pending + forceOverride → running (emitResetAll)', () => {
    assertValid('pending', { type: 'forceOverride' }, 'running', [
      'emitResetAll',
    ]);
  });

  it('running + streamCompleted → verifying (no side effects)', () => {
    assertValid('running', { type: 'streamCompleted' }, 'verifying', []);
  });

  it('running + throw → failed (no side effects)', () => {
    assertValid(
      'running',
      { type: 'throw', reason: 'network error' },
      'failed',
      [],
    );
  });

  it('running + forceOverride → running (emitResetAll)', () => {
    assertValid('running', { type: 'forceOverride' }, 'running', [
      'emitResetAll',
    ]);
  });

  it('running + staleRunningDetected → retrying (no side effects)', () => {
    assertValid('running', { type: 'staleRunningDetected' }, 'retrying', []);
  });

  it('verifying + verifyPassed → done (resetCursor)', () => {
    assertValid('verifying', { type: 'verifyPassed' }, 'done', ['resetCursor']);
  });

  it('verifying + verifyFailed → failed (no side effects)', () => {
    assertValid(
      'verifying',
      { type: 'verifyFailed', reason: 'missing pages' },
      'failed',
      [],
    );
  });

  it('verifying + forceOverride → running (emitResetAll)', () => {
    assertValid('verifying', { type: 'forceOverride' }, 'running', [
      'emitResetAll',
    ]);
  });

  it('done + forceOverride → running (emitResetAll)', () => {
    assertValid('done', { type: 'forceOverride' }, 'running', ['emitResetAll']);
  });

  it('failed + retryScheduled → retrying (no side effects)', () => {
    assertValid(
      'failed',
      { type: 'retryScheduled', attemptNo: 1 },
      'retrying',
      [],
    );
  });

  it('failed + forceOverride → running (emitResetAll)', () => {
    assertValid('failed', { type: 'forceOverride' }, 'running', [
      'emitResetAll',
    ]);
  });

  it('retrying + start → running (no side effects)', () => {
    assertValid(
      'retrying',
      { type: 'start', triggerSource: 'admin-ui' },
      'running',
      [],
    );
  });

  it('retrying + retryExhausted → escalated (no side effects)', () => {
    assertValid('retrying', { type: 'retryExhausted' }, 'escalated', []);
  });

  it('retrying + forceOverride → running (emitResetAll)', () => {
    assertValid('retrying', { type: 'forceOverride' }, 'running', [
      'emitResetAll',
    ]);
  });

  it('escalated + forceOverride → running (emitResetAll)', () => {
    assertValid('escalated', { type: 'forceOverride' }, 'running', [
      'emitResetAll',
    ]);
  });
});

describe('transition — side effects detail', () => {
  it('verifyPassed produces exactly one resetCursor effect', () => {
    const result = transition('verifying', { type: 'verifyPassed' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sideEffects).toHaveLength(1);
    expect(result.sideEffects[0]).toEqual({ kind: 'resetCursor' });
  });

  it('forceOverride produces exactly one emitResetAll effect', () => {
    const result = transition('pending', { type: 'forceOverride' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sideEffects).toHaveLength(1);
    expect(result.sideEffects[0]).toEqual({ kind: 'emitResetAll' });
  });

  it('normal start produces no side effects', () => {
    const result = transition('pending', {
      type: 'start',
      triggerSource: 'env-true',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sideEffects).toHaveLength(0);
  });
});

describe('transition — INVALID transitions', () => {
  it('done + start → invalid (done→running only via forceOverride)', () => {
    assertInvalid('done', { type: 'start', triggerSource: 'env-true' });
  });

  it('running + start → invalid (double-start prevention)', () => {
    assertInvalid('running', { type: 'start', triggerSource: 'admin-ui' });
  });

  it('escalated + retryScheduled → invalid', () => {
    assertInvalid('escalated', { type: 'retryScheduled', attemptNo: 5 });
  });

  it('pending + streamCompleted → invalid (not in table)', () => {
    assertInvalid('pending', { type: 'streamCompleted' });
  });

  it('done + streamCompleted → invalid (not in table)', () => {
    assertInvalid('done', { type: 'streamCompleted' });
  });

  it('done + retryScheduled → invalid (not in table)', () => {
    assertInvalid('done', { type: 'retryScheduled', attemptNo: 1 });
  });

  it('escalated + start → invalid (not forceOverride)', () => {
    assertInvalid('escalated', { type: 'start', triggerSource: 'env-force' });
  });
});

describe('transition — forceOverride from ALL 7 states → running', () => {
  const allStates: BootstrapState[] = [
    'pending',
    'running',
    'verifying',
    'done',
    'failed',
    'retrying',
    'escalated',
  ];

  for (const state of allStates) {
    it(`${state} + forceOverride → running`, () => {
      assertValid(state, { type: 'forceOverride' }, 'running');
    });
  }
});

describe('transition — pure function guarantees', () => {
  it('does not throw for invalid transitions (returns { ok: false })', () => {
    expect(() => transition('done', { type: 'streamCompleted' })).not.toThrow();
    const result = transition('done', { type: 'streamCompleted' });
    expect(result.ok).toBe(false);
  });

  it('returns an immutable-style result (no mutation of inputs)', () => {
    const event: BootstrapEvent = { type: 'start', triggerSource: 'env-true' };
    transition('pending', event);
    // event should remain unchanged
    expect(event).toEqual({ type: 'start', triggerSource: 'env-true' });
  });

  it('sideEffects is a readonly array (accessible via index)', () => {
    const result = transition('verifying', { type: 'verifyPassed' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.sideEffects)).toBe(true);
    expect(result.sideEffects[0]).toEqual({ kind: 'resetCursor' });
  });
});
