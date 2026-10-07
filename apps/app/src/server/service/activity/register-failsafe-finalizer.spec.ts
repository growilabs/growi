/**
 * Unit tests for registerFailsafeFinalizer (Task 3.2).
 *
 * Observable contract (design.md: Service / fail-safe > registerFailsafeFinalizer;
 * tasks.md Task 3.2; requirement 4.1):
 *   - `res` 'finish' with statusCode >= 400 (error response)      -> records
 *     an attempt (calls recordFailsafeAttempt once) and clears the pending
 *     context.
 *   - `res` 'finish' with statusCode < 400 (successful completion) -> does
 *     NOT record an attempt, but still clears the pending context.
 *   - `res` 'close' with writableFinished === false (a true client
 *     interruption -- the response never finished writing)          -> records
 *     an attempt and clears the pending context.
 *   - `res` 'close' with writableFinished === true (a normal completion that
 *     also emits 'close' after 'finish')                            -> does
 *     NOT record an attempt, but still clears the pending context.
 *
 * `recordFailsafeAttempt` and `pendingActivityContext.clear` are mocked at
 * the module boundary (both are called through the sibling modules per the
 * design, never re-implemented here), so these tests assert only the
 * finalizer's own responsibility: which `res` events trigger an attempt,
 * and that cleanup always fires -- not how the listeners are wired
 * internally (essential-test-design).
 */
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { mock } from 'vitest-mock-extended';

import type { PendingActivityContext } from './pending-activity-context';

vi.mock('./record-failsafe-attempt', () => ({
  recordFailsafeAttempt: vi.fn(),
}));

vi.mock('./pending-activity-context', () => ({
  clear: vi.fn(),
  set: vi.fn(),
  take: vi.fn(),
}));

import * as pendingActivityContext from './pending-activity-context';
import { recordFailsafeAttempt } from './record-failsafe-attempt';
import { registerFailsafeFinalizer } from './register-failsafe-finalizer';

const mockRecordFailsafeAttempt = vi.mocked(recordFailsafeAttempt);
const mockClear = vi.mocked(pendingActivityContext.clear);

const buildContext = (): PendingActivityContext => ({
  ip: '192.0.2.1',
  endpoint: '/_api/v3/pages/update',
  userId: '507f1f77bcf86cd799439011',
  username: 'alice',
  createdAt: new Date('2026-07-08T00:00:00.000Z'),
});

/**
 * Build a fake `res` that is a *real* EventEmitter under `on` -- a plain
 * `mock<Response>()` auto-stubs `on` as a no-op, so listeners the SUT
 * registers would never actually fire. The cast is localized to just the
 * `on` field (essential-test-patterns Tier 2): everything else on the
 * returned object is a type-safe `mock<Response>()`.
 */
function buildFakeRes(overrides: {
  statusCode: number;
  writableFinished: boolean;
}): { res: Response; emitter: EventEmitter } {
  const emitter = new EventEmitter();
  const res = mock<Response>({
    ...overrides,
    on: emitter.on.bind(emitter) as Response['on'],
  });
  return { res, emitter };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerFailsafeFinalizer', () => {
  const activityId = '507f1f77bcf86cd799439099';
  const context = buildContext();

  describe("'finish'", () => {
    it('records an attempt and clears the pending context when statusCode >= 400', () => {
      const { res, emitter } = buildFakeRes({
        statusCode: 500,
        writableFinished: true,
      });

      registerFailsafeFinalizer(res, activityId, context);
      emitter.emit('finish');

      expect(mockRecordFailsafeAttempt).toHaveBeenCalledTimes(1);
      expect(mockRecordFailsafeAttempt).toHaveBeenCalledWith(
        activityId,
        context,
      );
      expect(mockClear).toHaveBeenCalledWith(activityId);
    });

    it('does not record an attempt, but still clears the pending context, when statusCode < 400', () => {
      const { res, emitter } = buildFakeRes({
        statusCode: 200,
        writableFinished: true,
      });

      registerFailsafeFinalizer(res, activityId, context);
      emitter.emit('finish');

      expect(mockRecordFailsafeAttempt).not.toHaveBeenCalled();
      expect(mockClear).toHaveBeenCalledWith(activityId);
    });
  });

  describe("'close'", () => {
    it('records an attempt and clears the pending context when writableFinished === false (true client interruption)', () => {
      const { res, emitter } = buildFakeRes({
        statusCode: 200,
        writableFinished: false,
      });

      registerFailsafeFinalizer(res, activityId, context);
      emitter.emit('close');

      expect(mockRecordFailsafeAttempt).toHaveBeenCalledTimes(1);
      expect(mockRecordFailsafeAttempt).toHaveBeenCalledWith(
        activityId,
        context,
      );
      expect(mockClear).toHaveBeenCalledWith(activityId);
    });

    it('does not record an attempt, but still clears the pending context, when writableFinished === true (normal completion)', () => {
      const { res, emitter } = buildFakeRes({
        statusCode: 200,
        writableFinished: true,
      });

      registerFailsafeFinalizer(res, activityId, context);
      emitter.emit('close');

      expect(mockRecordFailsafeAttempt).not.toHaveBeenCalled();
      expect(mockClear).toHaveBeenCalledWith(activityId);
    });
  });

  it('clears the pending context on every path: error finish, success finish, interrupted close, and normal close', () => {
    const scenarios: Array<{
      event: 'finish' | 'close';
      statusCode: number;
      writableFinished: boolean;
    }> = [
      { event: 'finish', statusCode: 500, writableFinished: true },
      { event: 'finish', statusCode: 200, writableFinished: true },
      { event: 'close', statusCode: 200, writableFinished: false },
      { event: 'close', statusCode: 200, writableFinished: true },
    ];

    for (const scenario of scenarios) {
      mockClear.mockClear();
      const { res, emitter } = buildFakeRes(scenario);

      registerFailsafeFinalizer(res, activityId, context);
      emitter.emit(scenario.event);

      expect(mockClear).toHaveBeenCalledWith(activityId);
    }
  });
});
