/**
 * Unit tests for recordFailsafeAttempt (Task 3.1) covering the two contracts
 * that are impractical to force through the real DB in
 * record-failsafe-attempt.integ.ts:
 *
 *   - Best-effort on a NON-duplicate-key create failure: the function must
 *     not throw (the caller is a `res` finalizer with the request already
 *     ending), and the failure is surfaced via logger.error, not swallowed
 *     silently (req 4.1; design.md Error Handling: finalizer の作成失敗).
 *   - No pre-read: recordFailsafeAttempt must call ONLY the create port.
 *     It must never call an existence-check method (`findFirst`) first --
 *     duplicate-key absorption on the create itself is the ONLY
 *     double-create guard (Issue 1; design.md: 事前 read はしない).
 *
 * The duplicate-key-is-swallowed-and-no-second-row-is-created contract
 * itself is proven against the REAL Prisma duplicate-key error shape in
 * record-failsafe-attempt.integ.ts -- asserting it here too, against a
 * hand-built error object, would just re-assert the mechanism instead of
 * the observable outcome (essential-test-design).
 *
 * The create port (`prisma.activities.createByParameters`) and the
 * existence-check port (`findFirst`) are mocked type-safely via `mock<T>()`
 * (vitest-mock-extended), scoped via `Pick` to the methods relevant here --
 * mirrors settle-activity-record.spec.ts's mocking approach.
 */
import { mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

import type { PendingActivityContext } from './pending-activity-context';

type ActivitiesFailsafePort = Pick<
  (typeof prisma)['activities'],
  'createByParameters' | 'findFirst'
>;

const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
  }),
}));

// The real prisma client connects to a DB unavailable in unit tests; mock the
// boundary so createByParameters/findFirst are controllable, type-safe mocks.
// `mock<T>()` is called directly inside the factory -- see
// settle-activity-record.spec.ts for why (vi.mock hoisting / TDZ).
vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: mock<ActivitiesFailsafePort>(),
  },
}));

import { recordFailsafeAttempt } from './record-failsafe-attempt';

const mockCreateByParameters = vi.mocked(prisma.activities.createByParameters);
const mockFindFirst = vi.mocked(prisma.activities.findFirst);

const buildContext = (): PendingActivityContext => ({
  ip: '192.0.2.9',
  endpoint: '/_api/v3/pages/update',
  userId: '507f1f77bcf86cd799439022',
  username: 'operator',
  createdAt: new Date('2026-07-08T00:00:00.000Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordFailsafeAttempt', () => {
  it('calls only the create port with ACTION_UNSETTLED + the pre-minted id + the mapped context, and never calls findFirst (no pre-read -- Issue 1)', async () => {
    mockCreateByParameters.mockResolvedValueOnce({
      action: SupportedAction.ACTION_UNSETTLED,
      createdAt: new Date('2026-07-08T00:00:00.000Z'),
    });

    const activityId = '507f1f77bcf86cd799439099';
    const context = buildContext();

    await recordFailsafeAttempt(activityId, context);

    expect(mockCreateByParameters).toHaveBeenCalledTimes(1);
    const arg = mockCreateByParameters.mock.calls[0][0];
    expect(arg).toMatchObject({
      id: activityId,
      action: SupportedAction.ACTION_UNSETTLED,
      ip: context.ip,
      endpoint: context.endpoint,
      createdAt: context.createdAt,
      // operator id -> `user` (createByParameters normalizes it to userId;
      // a top-level `userId` is ignored -- Implementation Note 2)
      user: context.userId,
    });
    expect(arg.snapshot).toEqual(
      expect.objectContaining({ username: context.username }),
    );
    // Guard against the persistence-breaking regression: never a stray
    // top-level userId/username (dropped / rejected by Prisma respectively).
    expect(arg).not.toHaveProperty('userId');
    expect(arg).not.toHaveProperty('username');

    // No pre-read: the ONLY database call is the create itself.
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('does not throw and logs via logger.error on a non-duplicate-key create failure (best-effort -- req 4.1)', async () => {
    const unexpectedError = new Error('connection reset');
    mockCreateByParameters.mockRejectedValueOnce(unexpectedError);

    const activityId = '507f1f77bcf86cd799439099';

    await expect(
      recordFailsafeAttempt(activityId, buildContext()),
    ).resolves.toBeUndefined();

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError.mock.calls[0]).toContain(unexpectedError);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
