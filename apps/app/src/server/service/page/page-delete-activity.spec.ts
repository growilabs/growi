/**
 * Unit tests for Task 6 — revertDeletedPage's self pre-create is folded into
 * beginActivity + emit (Option C / lazy fail-safe).
 *
 * Observable contract (design.md: revertDeletedPage; tasks.md Task 6;
 * requirements 1.2, 3.3):
 *   - revertDeletedPage no longer self-pre-creates an ACTION_UNSETTLED row
 *     via prisma.activities.createByParameters. It mints an id and stashes
 *     the request-time context through the SAME shared helper the
 *     add-activity middleware uses (beginActivity), then emits 'update' with
 *     that id -- the real action row is created lazily by the real listener
 *     (settleActivityRecord), not here.
 *   - Any throw in the synchronous body BEFORE the emit fires must clear the
 *     pending context (pendingActivityContext.clear) so it is never
 *     orphaned -- there is no `res` finalizer on this flow, unlike the
 *     middleware path.
 *   - The detached, fire-and-forget recursive scope's own catch (guarding
 *     revertRecursivelyMainOperation) must ALSO clear the pending context if
 *     it throws before its own emit.
 *
 * beginActivity / pendingActivityContext are mocked at the module boundary
 * (both are shared helpers owned by service/activity, covered by their own
 * unit tests -- begin-activity.spec.ts, pending-activity-context.spec.ts).
 * Here we assert only what revertDeletedPage itself is responsible for:
 * calling them with the right arguments and at the right time
 * (essential-test-design: don't duplicate their tests).
 *
 * Environment constraint: MongoDB unavailable in local dev -> the real-DB,
 * real-listener "the real action row is actually persisted" contract is
 * covered end-to-end by revert-cascade-activity.integ.ts.
 *
 * IMPORTANT: vi.mock is hoisted above all imports by Vitest's transform.
 * Variables declared with const/let outside the factory are NOT available
 * inside the factory at hoisting time. Use vi.hoisted() for injectable mock
 * functions.
 */

import EventEmitter from 'node:events';
import type { HydratedDocument } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import PageEvent from '~/server/events/page';
import type { PageDocument } from '~/server/models/page';
import type { IPageOperationService } from '~/server/service/page-operation';

// ---------------------------------------------------------------------------
// Hoisted mock functions (available inside vi.mock factories).
// ---------------------------------------------------------------------------

const {
  mockBeginActivity,
  mockPendingActivityContextClear,
  mockGetRevertDeletedPageName,
  mockFindByPath,
  mockFindByIdAndUpdate,
  mockPageTagRelationUpdateMany,
  mockPageOperationCreate,
  mockPageOperationDeleteOne,
} = vi.hoisted(() => ({
  mockBeginActivity: vi.fn(),
  mockPendingActivityContextClear: vi.fn(),
  mockGetRevertDeletedPageName: vi.fn(),
  mockFindByPath: vi.fn(),
  mockFindByIdAndUpdate: vi.fn(),
  mockPageTagRelationUpdateMany: vi.fn(),
  mockPageOperationCreate: vi.fn(),
  mockPageOperationDeleteOne: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mock: ~/server/service/activity/index (the shared barrel).
// Full mock (not a partial/call-through): beginActivity's own mint+stash
// behavior is covered by begin-activity.spec.ts; here we only assert THIS
// call site's arguments and that a synchronous throw clears the id it mints.
// ---------------------------------------------------------------------------

vi.mock('~/server/service/activity/index', () => ({
  beginActivity: mockBeginActivity,
  pendingActivityContext: {
    clear: mockPendingActivityContextClear,
    take: vi.fn(),
    set: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Module-level mock: mongoose.model('Page') -- a single shared stand-in
// object is returned regardless of model name (every call site reachable
// from revertDeletedPage's synchronous body asks for 'Page' only). Each test
// configures only the methods its own branch reaches.
// ---------------------------------------------------------------------------

vi.mock('mongoose', async (importOriginal) => {
  const original = await importOriginal<typeof import('mongoose')>();
  return {
    ...original,
    default: {
      ...original.default,
      model: vi.fn().mockReturnValue({
        getRevertDeletedPageName: mockGetRevertDeletedPageName,
        findByPath: mockFindByPath,
        findByIdAndUpdate: mockFindByIdAndUpdate,
        STATUS_PUBLISHED: 'PUBLISHED',
      }),
    },
  };
});

// ---------------------------------------------------------------------------
// Module-level mock: PageTagRelation (post-revert relatedPage cleanup).
// ---------------------------------------------------------------------------

vi.mock('~/server/models/page-tag-relation', () => ({
  default: { updateMany: mockPageTagRelationUpdateMany },
}));

// ---------------------------------------------------------------------------
// Module-level mock: PageOperation (recursive-revert bookkeeping). Mocked by
// the SAME relative specifier index.ts uses ('../../models/page-operation'),
// since Vitest resolves vi.mock's path relative to the calling (test) file
// and this spec lives in the same directory as index.ts.
// ---------------------------------------------------------------------------

vi.mock('../../models/page-operation', () => ({
  default: {
    create: mockPageOperationCreate,
    deleteOne: mockPageOperationDeleteOne,
  },
}));

// ---------------------------------------------------------------------------
// Import PageService AFTER mock declarations.
// ---------------------------------------------------------------------------
import PageService from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Crowi mock that satisfies the PageService constructor:
 *   this.pageEvent      = crowi.events.page      (real PageEvent — needs on())
 *   this.tagEvent       = crowi.events.tag        (deep-mocked — needs on())
 *   this.activityEvent  = crowi.events.activity   (real EventEmitter — emit observable)
 *   this.pageGrantService = crowi.pageGrantService (deep-mocked, unused here)
 * `pageOperationService.canOperate` is returned separately so each test can
 * configure the v5 `canOperate` gate check without reaching into `crowi`.
 */
function makeCrowi() {
  const activityEmitter = new EventEmitter();
  const pageEvent = new PageEvent(mock<Crowi>());
  const mockCanOperate = vi.fn<IPageOperationService['canOperate']>();
  const pageOperationService = mock<IPageOperationService>({
    canOperate: mockCanOperate,
  });

  const crowi = mock<Crowi>({
    events: {
      page: pageEvent as unknown as typeof crowi.events.page,
      activity: activityEmitter as unknown as typeof crowi.events.activity,
    },
    pageOperationService,
  });

  return { crowi, activityEmitter, mockCanOperate };
}

const ACTIVITY_ID = '507f1f77bcf86cd799439099';

beforeEach(() => {
  vi.clearAllMocks();
  mockBeginActivity.mockReturnValue({ activityId: ACTIVITY_ID });
});

describe('PageService.revertDeletedPage — activity recording (Task 6)', () => {
  describe('mint + emit wiring', () => {
    it('mints via beginActivity (ip/endpoint from activityParameters, userId/username from user, createdAt at arrival time) and emits update with the minted id -- V4 path', async () => {
      vi.useFakeTimers();
      const arrivalTime = new Date('2026-07-09T00:00:00.000Z');
      vi.setSystemTime(arrivalTime);

      try {
        const { crowi, activityEmitter } = makeCrowi();
        const service = new PageService(crowi);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(service as any, 'shouldUseV4ProcessForRevert').mockReturnValue(
          true,
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.spyOn(service as any, 'revertDeletedPageV4').mockResolvedValue({
          path: '/test',
        });
        const emitSpy = vi.spyOn(activityEmitter, 'emit');

        const user = { _id: 'user-object-id', username: 'alice' };
        const page = {
          _id: 'page-object-id',
          path: '/trash/test',
          descendantCount: 0,
        };
        const activityParameters = {
          ip: '127.0.0.1',
          endpoint: '/api/v3/revert',
        };

        await service.revertDeletedPage(
          page,
          user,
          {},
          false,
          activityParameters,
        );

        expect(mockBeginActivity).toHaveBeenCalledTimes(1);
        expect(mockBeginActivity).toHaveBeenCalledWith({
          ip: '127.0.0.1',
          endpoint: '/api/v3/revert',
          userId: 'user-object-id',
          username: 'alice',
          createdAt: arrivalTime,
        });

        expect(emitSpy).toHaveBeenCalledWith('update', ACTIVITY_ID, {
          action: SupportedAction.ACTION_PAGE_REVERT,
          target: page,
          targetModel: SupportedTargetModel.MODEL_PAGE,
          contributor: user,
        });
        // Success path: cleanup belongs to the listener's `take`, not to
        // revertDeletedPage itself.
        expect(mockPendingActivityContextClear).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('pending-context cleanup on emit-before-throw (no orphan)', () => {
    it('V4 branch: a throw from revertDeletedPageV4 (before any emit) clears the minted id and rethrows', async () => {
      const { crowi, activityEmitter } = makeCrowi();
      const service = new PageService(crowi);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(service as any, 'shouldUseV4ProcessForRevert').mockReturnValue(
        true,
      );
      const boom = new Error('revertDeletedPageV4 boom');
      vi
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn(service as any, 'revertDeletedPageV4')
        .mockRejectedValue(boom);
      const emitSpy = vi.spyOn(activityEmitter, 'emit');

      const user = { _id: 'user-id', username: 'bob' };
      const page = { _id: 'page-id', path: '/trash/test', descendantCount: 0 };
      const activityParameters = {
        ip: '127.0.0.1',
        endpoint: '/api/v3/revert',
      };

      await expect(
        service.revertDeletedPage(page, user, {}, false, activityParameters),
      ).rejects.toThrow(boom);

      expect(emitSpy).not.toHaveBeenCalled();
      expect(mockPendingActivityContextClear).toHaveBeenCalledTimes(1);
      expect(mockPendingActivityContextClear).toHaveBeenCalledWith(ACTIVITY_ID);
    });

    it('v5 branch: a throw from a false canOperate check (before any emit) clears the minted id and rethrows', async () => {
      const { crowi, activityEmitter, mockCanOperate } = makeCrowi();
      const service = new PageService(crowi);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(service as any, 'shouldUseV4ProcessForRevert').mockReturnValue(
        false,
      );
      mockGetRevertDeletedPageName.mockReturnValueOnce('/reverted');
      mockCanOperate.mockResolvedValueOnce(false);
      const emitSpy = vi.spyOn(activityEmitter, 'emit');

      const user = { _id: 'user-id', username: 'carol' };
      const page = { _id: 'page-id', path: '/trash/test', descendantCount: 0 };
      const activityParameters = {
        ip: '127.0.0.1',
        endpoint: '/api/v3/revert',
      };

      await expect(
        service.revertDeletedPage(page, user, {}, false, activityParameters),
      ).rejects.toThrow(/Cannot operate revert/);

      expect(emitSpy).not.toHaveBeenCalled();
      expect(mockPendingActivityContextClear).toHaveBeenCalledTimes(1);
      expect(mockPendingActivityContextClear).toHaveBeenCalledWith(ACTIVITY_ID);
    });

    it('recursive branch: the detached async scope clears the minted id when revertRecursivelyMainOperation rejects before its own emit', async () => {
      const { crowi, mockCanOperate } = makeCrowi();
      const service = new PageService(crowi);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(service as any, 'shouldUseV4ProcessForRevert').mockReturnValue(
        false,
      );
      mockGetRevertDeletedPageName.mockReturnValueOnce('/reverted-recursive');
      mockCanOperate.mockResolvedValueOnce(true);
      mockFindByPath.mockResolvedValueOnce(null); // no page already at the target path
      vi.spyOn(
        service,
        'getParentAndFillAncestorsByUser',
      ).mockResolvedValueOnce(
        // Tier-2 cast (essential-test-patterns tolerance framework): a full
        // HydratedDocument<PageDocument> would need many Mongoose Document
        // method stubs this test never exercises -- only `_id` feeds the
        // code path under test (`parent._id` in the $set below it).
        { _id: 'parent-id' } as unknown as HydratedDocument<PageDocument>,
      );
      mockFindByIdAndUpdate.mockResolvedValueOnce({
        _id: 'updated-page-id',
        path: '/reverted-recursive',
      });
      mockPageTagRelationUpdateMany.mockResolvedValueOnce({});
      mockPageOperationCreate.mockResolvedValueOnce({ _id: 'page-op-id' });
      mockPageOperationDeleteOne.mockResolvedValueOnce({});

      const boom = new Error('revertRecursivelyMainOperation boom');
      vi.spyOn(service, 'revertRecursivelyMainOperation').mockRejectedValueOnce(
        boom,
      );

      const user = { _id: 'user-id', username: 'dana' };
      // descendantCount > 0 resolves ACTION_PAGE_RECURSIVELY_REVERT and
      // takes the recursive (isRecursively=true) branch; no real descendant
      // pages are needed -- the resolved action and branch are driven
      // purely by descendantCount and the isRecursively flag (same trick
      // used by v5.public-page.integ.ts's recursive-revert activity test).
      const page = { _id: 'page-id', path: '/trash/test', descendantCount: 1 };
      const activityParameters = {
        ip: '127.0.0.1',
        endpoint: '/api/v3/revert',
      };

      // revertRecursivelyMainOperation runs inside a detached,
      // fire-and-forget async IIFE (design.md: revertDeletedPage). Its
      // `throw err` at the end of the IIFE's own catch is never awaited or
      // `.catch()`-handled by any caller -- a PRE-EXISTING property of this
      // code path, unchanged by this task (the original code already threw
      // there; this task only adds one cleanup call inside the same catch).
      // Left unhandled, Node reports it as an unhandled rejection. A scoped
      // listener drains it deterministically for the duration of this test.
      const rejections: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => {
        rejections.push(reason);
      };
      process.on('unhandledRejection', onUnhandledRejection);

      try {
        // Resolves once the synchronous body returns -- it does NOT await
        // the detached IIFE (that is the point of "fire-and-forget").
        const updatedPage = await service.revertDeletedPage(
          page,
          user,
          {},
          true,
          activityParameters,
        );
        expect(updatedPage).toEqual({
          _id: 'updated-page-id',
          path: '/reverted-recursive',
        });

        // The IIFE's catch runs asynchronously; poll for its side effects
        // instead of an arbitrary sleep.
        const start = Date.now();
        while (mockPendingActivityContextClear.mock.calls.length === 0) {
          if (Date.now() - start > 2000) {
            throw new Error(
              'timed out waiting for the detached recursive scope to clean up',
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        expect(mockPageOperationDeleteOne).toHaveBeenCalledWith({
          _id: 'page-op-id',
        });
        expect(mockPendingActivityContextClear).toHaveBeenCalledTimes(1);
        expect(mockPendingActivityContextClear).toHaveBeenCalledWith(
          ACTIVITY_ID,
        );
        expect(rejections).toEqual([boom]);
      } finally {
        process.off('unhandledRejection', onUnhandledRejection);
      }
    });
  });
});
