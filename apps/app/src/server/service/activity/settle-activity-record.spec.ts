/**
 * Unit tests for settleActivityRecord (Task 2).
 *
 * Observable contract (design.md: Service / 記録ライフサイクル > settleActivityRecord;
 * tasks.md Task 2):
 *   - shouldPersist=false -> the create port is NOT called; returns null
 *     (no write for an out-of-gate action -- Requirement 1.1).
 *   - shouldPersist=true  -> the create port IS called once with an argument
 *     that merges the pre-minted id, the context fields (including the
 *     arrival-time `createdAt` -- Issue 3), and the emit action/params;
 *     returns the created activity (Requirements 1.2, 2.6).
 *
 * The create port (`prisma.activities.createByParameters`) is mocked
 * type-safely via `mock<T>()` (vitest-mock-extended), scoped via `Pick` to
 * just the one method this function calls -- see essential-test-patterns
 * skill, Tier-1 `mock<T>()` usage (no type assertions for the mock itself).
 */
import { mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';
import { prisma } from '~/utils/prisma';

import type { PendingActivityContext } from './pending-activity-context';

type ActivitiesCreatePort = Pick<
  (typeof prisma)['activities'],
  'createByParameters'
>;

// Mock the prisma client boundary so createByParameters is a controllable,
// type-safe mock. The real prisma client connects to a DB unavailable in
// unit tests.
//
// `mock<T>()` is called directly INSIDE the factory (not hoisted via
// vi.hoisted()): Vitest hoists this vi.mock call above the `import { mock }
// from 'vitest-mock-extended'` binding's initialization, so referencing
// `mock` from within a vi.hoisted() callback throws a TDZ ReferenceError
// (confirmed empirically). The factory closure itself is only invoked when
// the mocked module is actually loaded, by which point the import is bound.
vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: mock<ActivitiesCreatePort>(),
  },
}));

// Import after the mock declaration. `prisma` here IS the mocked module's
// export (see vi.mock above): at runtime `prisma.activities.createByParameters`
// already IS the mock<T>()-produced function from the factory. `vi.mocked()`
// (built into Vitest, not a type assertion) narrows its *static* type -- the
// real `~/utils/prisma` module's declared type -- to expose the mock's
// assertion/configuration methods (`mockResolvedValueOnce`, `toHaveBeenCalledWith`, ...).
import { settleActivityRecord } from './settle-activity-record';

const mockCreateByParameters = vi.mocked(prisma.activities.createByParameters);

const buildContext = (): PendingActivityContext => ({
  ip: '192.0.2.1',
  endpoint: '/_api/v3/pages/rename',
  userId: '507f1f77bcf86cd799439011',
  username: 'alice',
  createdAt: new Date('2026-07-08T00:00:00.000Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settleActivityRecord', () => {
  describe('shouldPersist=false (out-of-gate)', () => {
    it('does not call the create port and returns null', async () => {
      const result = await settleActivityRecord({
        activityId: '507f1f77bcf86cd799439099',
        shouldPersist: false,
        context: buildContext(),
        activityParameters: { action: SupportedAction.ACTION_PAGE_UPDATE },
      });

      expect(mockCreateByParameters).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('does not call the create port even when context is undefined', async () => {
      const result = await settleActivityRecord({
        activityId: '507f1f77bcf86cd799439099',
        shouldPersist: false,
        context: undefined,
        activityParameters: { action: SupportedAction.ACTION_PAGE_UPDATE },
      });

      expect(mockCreateByParameters).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('shouldPersist=true (in-gate)', () => {
    // Assert the call shape createByParameters ACTUALLY consumes
    // (models/activity.ts): the operator id must go in `user` (it derives the
    // row's userId via normalizeToId(user); a top-level `userId` is ignored),
    // and the operator name must go in `snapshot.username` (the activities
    // model has no top-level `username` column -- a stray one would make Prisma
    // create throw). Asserting the raw context shape (top-level userId/username)
    // would encode a mechanism that never persists (essential-test-design);
    // the authoritative read-back-from-DB proof is Task 7.2's integ test.
    it('calls the create port once with id + ip + endpoint + arrival-time createdAt + operator id (as `user`) + operator name (as `snapshot.username`) + emit action/target, and returns the created activity', async () => {
      const createdActivity = {
        action: SupportedAction.ACTION_PAGE_UPDATE,
        createdAt: new Date('2026-07-08T00:00:00.000Z'),
      };
      mockCreateByParameters.mockResolvedValueOnce(createdActivity);

      const context = buildContext();
      const activityId = '507f1f77bcf86cd799439099';

      const result = await settleActivityRecord({
        activityId,
        shouldPersist: true,
        context,
        activityParameters: {
          action: SupportedAction.ACTION_PAGE_UPDATE,
          target: 'page-1',
        },
      });

      expect(mockCreateByParameters).toHaveBeenCalledTimes(1);
      const arg = mockCreateByParameters.mock.calls[0][0];

      expect(arg).toMatchObject({
        id: activityId,
        ip: context.ip,
        endpoint: context.endpoint,
        createdAt: context.createdAt,
        // operator id -> `user` (createByParameters normalizes it to userId)
        user: context.userId,
        action: SupportedAction.ACTION_PAGE_UPDATE,
        target: 'page-1',
      });
      // operator name -> `snapshot.username` (Req 2.6)
      expect(arg.snapshot).toEqual(
        expect.objectContaining({ username: context.username }),
      );

      // Guard against the persistence-breaking regression: the operator must
      // NOT be passed as a top-level `userId`/`username` (dropped / rejected by
      // Prisma respectively -- see createByParameters).
      expect(arg).not.toHaveProperty('userId');
      expect(arg).not.toHaveProperty('username');

      expect(result).toEqual(createdActivity);
    });

    it('keeps the operator username from context when the emit params carry no snapshot (Req 2.6 -- operator name is not dropped)', async () => {
      mockCreateByParameters.mockResolvedValueOnce({
        action: SupportedAction.ACTION_PAGE_UPDATE,
        createdAt: new Date('2026-07-08T00:00:00.000Z'),
      });

      const context = buildContext();

      await settleActivityRecord({
        activityId: '507f1f77bcf86cd799439099',
        shouldPersist: true,
        context,
        activityParameters: { action: SupportedAction.ACTION_PAGE_UPDATE },
      });

      const arg = mockCreateByParameters.mock.calls[0][0];
      expect(arg.snapshot?.username).toBe(context.username);
    });

    it('lets an action-specific snapshot username win while preserving its other snapshot fields (precedence + no field loss)', async () => {
      mockCreateByParameters.mockResolvedValueOnce({
        action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
        createdAt: new Date('2026-07-08T00:00:00.000Z'),
      });

      const context = buildContext();

      await settleActivityRecord({
        activityId: '507f1f77bcf86cd799439099',
        shouldPersist: true,
        context,
        activityParameters: {
          action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
          snapshot: {
            username: 'operator-from-snapshot',
            originalName: 'diagram.png',
          },
        },
      });

      const arg = mockCreateByParameters.mock.calls[0][0];
      // Provided snapshot username wins over the context username...
      expect(arg.snapshot?.username).toBe('operator-from-snapshot');
      // ...and the action-specific snapshot field is not dropped by the merge.
      expect(arg.snapshot).toEqual(
        expect.objectContaining({ originalName: 'diagram.png' }),
      );
    });
  });
});
