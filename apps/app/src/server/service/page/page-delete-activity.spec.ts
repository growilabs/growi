/**
 * Unit test for Task 3.3 — page delete (revert) activity recording via Prisma extension.
 *
 * Observable contract:
 *   When revertDeletedPage is called, it delegates activity creation to
 *   prisma.activities.createByParameters with the same parameters that were
 *   previously passed to Activity.createByParameters (user/target as objects,
 *   targetModel, snapshot, action=ACTION_UNSETTLED).
 *
 * Design constraint (Key Decision 4):
 *   The call site does NOT pre-normalize user/target objects to ID strings.
 *   Normalization is performed inside the extension (models/activity.ts).
 *
 * Environment constraint: MongoDB unavailable in local dev → integ tests skipped.
 *   Runtime is verified by the existing integ suite in CI (task 4.1).
 *
 * IMPORTANT: vi.mock is hoisted above all imports by Vitest's transform.
 * Variables declared with const/let outside the factory are NOT available inside
 * the factory at hoisting time. Use vi.hoisted() for injectable mock functions.
 */

import EventEmitter from 'node:events';
import { mock } from 'vitest-mock-extended';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import PageEvent from '~/server/events/page';

// ---------------------------------------------------------------------------
// Declare mock functions with vi.hoisted() so they are available inside the
// vi.mock factory (hoisted above all imports by Vitest).
// ---------------------------------------------------------------------------

const { mockCreateByParameters } = vi.hoisted(() => ({
  mockCreateByParameters: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mock: ~/utils/prisma
// ---------------------------------------------------------------------------

vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: {
      createByParameters: mockCreateByParameters,
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock mongoose.model so that revertDeletedPage's `const Page = mongoose.model('Page')`
// does not throw MissingSchemaError (we never reach Page calls in the V4 path
// because revertDeletedPageV4 is spied out, but mongoose.model is invoked
// before the v4/v5 branch is evaluated).
// ---------------------------------------------------------------------------

vi.mock('mongoose', async (importOriginal) => {
  const original = await importOriginal<typeof import('mongoose')>();
  return {
    ...original,
    default: {
      ...original.default,
      model: vi.fn().mockReturnValue({}),
    },
  };
});

// ---------------------------------------------------------------------------
// Import PageService AFTER mock declarations.
// ---------------------------------------------------------------------------
import PageService from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Crowi mock that satisfies PageService constructor:
 *   this.pageEvent   = crowi.events.page     (PageEvent — has onCreate/onCreateMany/onAddSeenUsers)
 *   this.tagEvent    = crowi.events.tag       (needs on())
 *   this.activityEvent = crowi.events.activity (needs on()/emit())
 *   this.pageGrantService = crowi.pageGrantService
 */
function makeCrowi() {
  const activityEmitter = new EventEmitter();
  const pageEvent = new PageEvent(mock<Crowi>());

  const crowi = mock<Crowi>({
    events: {
      // Tier-2 cast (essential-test-patterns §Tolerance framework): we need a
      // real PageEvent instance so initPageEvent()'s .on() calls succeed.
      page: pageEvent as unknown as typeof crowi.events.page,
      // Real EventEmitter for activity so emit() is observable in tests.
      activity: activityEmitter as unknown as typeof crowi.events.activity,
      // Tag event only needs .on() — deep mock provides it automatically.
    },
  });

  return { crowi, activityEmitter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PageService.revertDeletedPage — activity recording', () => {
  it('calls prisma.activities.createByParameters with user object, target page object, targetModel, snapshot, and ACTION_UNSETTLED', async () => {
    // Arrange
    const fakeActivity = {
      _id: 'fake-activity-id',
      action: SupportedAction.ACTION_UNSETTLED,
    };
    mockCreateByParameters.mockResolvedValueOnce(fakeActivity);

    const { crowi } = makeCrowi();
    const service = new PageService(crowi);

    // Spy on private methods to short-circuit the V4/V5 page operation logic
    // so the test does not require MongoDB or page models.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(service as any, 'shouldUseV4ProcessForRevert').mockReturnValue(
      true,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(service as any, 'revertDeletedPageV4').mockResolvedValue({
      path: '/test',
    });

    const user = { _id: 'user-object-id', username: 'alice' };
    const page = {
      _id: 'page-object-id',
      path: '/trash/test',
      descendantCount: 0,
    };
    const activityParameters = { ip: '127.0.0.1', endpoint: '/api/v3/revert' };

    // Act
    await service.revertDeletedPage(page, user, {}, false, activityParameters);

    // Assert — observable contract: prisma extension is called with user/target
    // objects (not pre-normalized IDs), matching Key Decision 4.
    expect(mockCreateByParameters).toHaveBeenCalledTimes(1);
    expect(mockCreateByParameters).toHaveBeenCalledWith({
      ip: activityParameters.ip,
      endpoint: activityParameters.endpoint,
      action: SupportedAction.ACTION_UNSETTLED,
      user,
      target: page,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      snapshot: { username: user.username },
    });
  });

  it('swallows prisma errors and continues page revert (recording failure must not stop main flow)', async () => {
    // Arrange
    mockCreateByParameters.mockRejectedValueOnce(new Error('DB error'));

    const { crowi } = makeCrowi();
    const service = new PageService(crowi);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(service as any, 'shouldUseV4ProcessForRevert').mockReturnValue(
      true,
    );
    const revertV4Spy = vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(service as any, 'revertDeletedPageV4')
      .mockResolvedValue({ path: '/test' });

    const user = { _id: 'user-id', username: 'bob' };
    const page = { _id: 'page-id', path: '/trash/test', descendantCount: 0 };
    const activityParameters = { ip: '127.0.0.1', endpoint: '/api/v3/revert' };

    // Act — must NOT throw even though createByParameters rejected
    await expect(
      service.revertDeletedPage(page, user, {}, false, activityParameters),
    ).resolves.not.toThrow();

    // Assert — revertDeletedPageV4 was still called (main flow continued)
    expect(revertV4Spy).toHaveBeenCalledTimes(1);
    expect(mockCreateByParameters).toHaveBeenCalledTimes(1);
  });
});
