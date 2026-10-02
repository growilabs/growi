import { describe, expect, it } from 'vitest';

import type { BootstrapState } from '../bootstrap-state-machine';
import {
  type BootstrapAction,
  type BootstrapEnvValue,
  resolveAction,
} from '../bootstrap-trigger-resolver';

// ---------------------------------------------------------------------------
// Table-driven helpers
// ---------------------------------------------------------------------------

type Row = {
  envValue: BootstrapEnvValue;
  state: BootstrapState;
  retryAllowed: boolean;
  isStaleRunning: boolean;
  expected: BootstrapAction['kind'];
};

function run(row: Row) {
  const result = resolveAction(
    row.envValue,
    row.state,
    row.retryAllowed,
    row.isStaleRunning,
  );
  expect(
    result.kind,
    `env=${row.envValue} state=${row.state} retry=${row.retryAllowed} stale=${row.isStaleRunning}`,
  ).toBe(row.expected);
}

// ---------------------------------------------------------------------------
// 1. env=force → always forceWipe regardless of state
// ---------------------------------------------------------------------------
describe('env=force', () => {
  const states: BootstrapState[] = [
    'pending',
    'running',
    'verifying',
    'done',
    'failed',
    'retrying',
    'escalated',
  ];

  it.each(states)('force + %s → forceWipe', (state) => {
    run({
      envValue: 'force',
      state,
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'forceWipe',
    });
    run({
      envValue: 'force',
      state,
      retryAllowed: true,
      isStaleRunning: false,
      expected: 'forceWipe',
    });
    run({
      envValue: 'force',
      state,
      retryAllowed: false,
      isStaleRunning: true,
      expected: 'forceWipe',
    });
    run({
      envValue: 'force',
      state,
      retryAllowed: true,
      isStaleRunning: true,
      expected: 'forceWipe',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. env=false → always skip
// ---------------------------------------------------------------------------
describe('env=false', () => {
  const states: BootstrapState[] = [
    'pending',
    'running',
    'verifying',
    'done',
    'failed',
    'retrying',
    'escalated',
  ];

  it.each(states)('false + %s → skip', (state) => {
    run({
      envValue: 'false',
      state,
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'skip',
    });
    run({
      envValue: 'false',
      state,
      retryAllowed: true,
      isStaleRunning: true,
      expected: 'skip',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. env=unknown → always skip
// ---------------------------------------------------------------------------
describe('env=unknown', () => {
  const states: BootstrapState[] = [
    'pending',
    'running',
    'verifying',
    'done',
    'failed',
    'retrying',
    'escalated',
  ];

  it.each(states)('unknown + %s → skip', (state) => {
    run({
      envValue: 'unknown',
      state,
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'skip',
    });
    run({
      envValue: 'unknown',
      state,
      retryAllowed: true,
      isStaleRunning: true,
      expected: 'skip',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. env=true + done → skip (already complete)
// ---------------------------------------------------------------------------
describe('env=true + done', () => {
  it('true + done + retryAllowed=false + isStaleRunning=false → skip', () => {
    run({
      envValue: 'true',
      state: 'done',
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'skip',
    });
  });
  it('true + done + retryAllowed=true + isStaleRunning=true → skip', () => {
    run({
      envValue: 'true',
      state: 'done',
      retryAllowed: true,
      isStaleRunning: true,
      expected: 'skip',
    });
  });
});

// ---------------------------------------------------------------------------
// 5. env=true + pending → startNew
// ---------------------------------------------------------------------------
describe('env=true + pending', () => {
  it('true + pending + retryAllowed=false + isStaleRunning=false → startNew', () => {
    run({
      envValue: 'true',
      state: 'pending',
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'startNew',
    });
  });
  it('true + pending + retryAllowed=true + isStaleRunning=true → startNew', () => {
    run({
      envValue: 'true',
      state: 'pending',
      retryAllowed: true,
      isStaleRunning: true,
      expected: 'startNew',
    });
  });
});

// ---------------------------------------------------------------------------
// 6. env=true + running → resumeFromCursor (stale) or skip (active)
// ---------------------------------------------------------------------------
describe('env=true + running', () => {
  it('true + running + isStaleRunning=true → resumeFromCursor', () => {
    run({
      envValue: 'true',
      state: 'running',
      retryAllowed: false,
      isStaleRunning: true,
      expected: 'resumeFromCursor',
    });
    run({
      envValue: 'true',
      state: 'running',
      retryAllowed: true,
      isStaleRunning: true,
      expected: 'resumeFromCursor',
    });
  });

  it("true + running + isStaleRunning=false → skip (active running — don't double-start)", () => {
    run({
      envValue: 'true',
      state: 'running',
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'skip',
    });
    run({
      envValue: 'true',
      state: 'running',
      retryAllowed: true,
      isStaleRunning: false,
      expected: 'skip',
    });
  });
});

// ---------------------------------------------------------------------------
// 7. env=true + failed
// ---------------------------------------------------------------------------
describe('env=true + failed', () => {
  it('true + failed + retryAllowed=true → resumeFromCursor', () => {
    run({
      envValue: 'true',
      state: 'failed',
      retryAllowed: true,
      isStaleRunning: false,
      expected: 'resumeFromCursor',
    });
    run({
      envValue: 'true',
      state: 'failed',
      retryAllowed: true,
      isStaleRunning: true,
      expected: 'resumeFromCursor',
    });
  });

  it('true + failed + retryAllowed=false → skip', () => {
    run({
      envValue: 'true',
      state: 'failed',
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'skip',
    });
    run({
      envValue: 'true',
      state: 'failed',
      retryAllowed: false,
      isStaleRunning: true,
      expected: 'skip',
    });
  });
});

// ---------------------------------------------------------------------------
// 8. env=true + retrying
// ---------------------------------------------------------------------------
describe('env=true + retrying', () => {
  it('true + retrying + retryAllowed=true → resumeFromCursor', () => {
    run({
      envValue: 'true',
      state: 'retrying',
      retryAllowed: true,
      isStaleRunning: false,
      expected: 'resumeFromCursor',
    });
  });

  it('true + retrying + retryAllowed=false → skip', () => {
    run({
      envValue: 'true',
      state: 'retrying',
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'skip',
    });
  });
});

// ---------------------------------------------------------------------------
// 9. env=true + escalated
// ---------------------------------------------------------------------------
describe('env=true + escalated', () => {
  it('true + escalated + retryAllowed=true → resumeFromCursor', () => {
    run({
      envValue: 'true',
      state: 'escalated',
      retryAllowed: true,
      isStaleRunning: false,
      expected: 'resumeFromCursor',
    });
    run({
      envValue: 'true',
      state: 'escalated',
      retryAllowed: true,
      isStaleRunning: true,
      expected: 'resumeFromCursor',
    });
  });

  it('true + escalated + retryAllowed=false → skip', () => {
    run({
      envValue: 'true',
      state: 'escalated',
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'skip',
    });
    run({
      envValue: 'true',
      state: 'escalated',
      retryAllowed: false,
      isStaleRunning: true,
      expected: 'skip',
    });
  });
});

// ---------------------------------------------------------------------------
// 10. env=true + verifying → skip (in-progress)
// ---------------------------------------------------------------------------
describe('env=true + verifying', () => {
  it('true + verifying + retryAllowed=false + isStaleRunning=false → skip', () => {
    run({
      envValue: 'true',
      state: 'verifying',
      retryAllowed: false,
      isStaleRunning: false,
      expected: 'skip',
    });
  });
  it('true + verifying + retryAllowed=true + isStaleRunning=true → skip', () => {
    run({
      envValue: 'true',
      state: 'verifying',
      retryAllowed: true,
      isStaleRunning: true,
      expected: 'skip',
    });
  });
});

// ---------------------------------------------------------------------------
// 11. Return type shape — triggerSource is attached for non-skip actions
// ---------------------------------------------------------------------------
describe('return shape', () => {
  it('startNew carries triggerSource env-true', () => {
    const action = resolveAction('true', 'pending', false, false);
    expect(action).toEqual({ kind: 'startNew', triggerSource: 'env-true' });
  });

  it('resumeFromCursor carries triggerSource env-true', () => {
    const action = resolveAction('true', 'failed', true, false);
    expect(action).toEqual({
      kind: 'resumeFromCursor',
      triggerSource: 'env-true',
    });
  });

  it('forceWipe carries triggerSource env-force', () => {
    const action = resolveAction('force', 'done', false, false);
    expect(action).toEqual({ kind: 'forceWipe', triggerSource: 'env-force' });
  });

  it('skip has no triggerSource', () => {
    const action = resolveAction('false', 'pending', false, false);
    expect(action).toEqual({ kind: 'skip' });
  });
});
