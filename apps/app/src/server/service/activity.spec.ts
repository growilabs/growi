/**
 * Unit tests for ActivityService's GET-path createActivity gate (unchanged)
 * and the "update" listener's lazy fail-safe record lifecycle (Task 5).
 *
 * Observable contracts for the "update" listener (design.md: Service /
 * orchestrator > ActivityService update listener; tasks.md Task 5):
 *   1. The pending context is taken from `pendingActivityContext`
 *      SYNCHRONOUSLY -- before any `await` in the handler (Requirement 2.6).
 *      Taking it late would race registerFailsafeFinalizer's cleanup and
 *      drop the IP/endpoint/username/createdAt the settled row needs.
 *   2. Contribution processing runs BEFORE settle, unconditionally of
 *      record-eligibility (Requirement 2.4).
 *   3. `shouldPersist` is computed via the single-source gate
 *      `shoudUpdateActivity` and injected into `settleActivityRecord` --
 *      the gate is never re-derived inside settle (Requirement 1.4/3.1).
 *   4. `updated` is emitted ONLY when settleActivityRecord returns non-null
 *      (in-gate AND created). An out-of-gate action (null, no write) or a
 *      settle failure both skip the emit (Requirement 1.1/2.3). The
 *      `generatePreNotify` branch split is preserved.
 *   5. The notify-construction input carries the acting user's id (from the
 *      taken context) as `user`, so the actor is excluded from a
 *      notification about their own action (Requirement 2.3; tasks.md
 *      Implementation Note "2→5"). The emitted `updated` activity itself
 *      stays the original settle result (no injected `user`).
 *   6. createTtlIndex still calls Activity.createIndexes (Mongoose, stays intact).
 *
 * Mocking strategy: `settleActivityRecord` and `pendingActivityContext.take`
 * are mocked at the module boundary -- the listener's contract with its
 * collaborators, which already have their own unit tests
 * (settle-activity-record.spec.ts, pending-activity-context.spec.ts).
 * `shoudUpdateActivity` is spied on the constructed instance so each test
 * controls record-eligibility directly, independent of the real
 * action-group configuration (that gate is covered by
 * ActivityService.createActivity's tests and getAvailableActions).
 * Contribution helpers are mocked so the contribution block never touches a
 * real DB; only their relative call order matters here.
 *
 * IMPORTANT: vi.mock is hoisted to the top of the file by Vitest's transform.
 * Variables declared with const/let outside the factory are NOT available inside
 * the factory at hoisting time.  Use vi.hoisted() to declare mock functions that
 * need to be both injectable into the factory AND inspectable in tests.
 */

import EventEmitter from 'node:events';
import { mock } from 'vitest-mock-extended';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import Activity from '~/server/models/activity';

// ---------------------------------------------------------------------------
// Declare mock functions with vi.hoisted() so they are available inside the
// vi.mock factories (which are hoisted above all imports by Vitest).
// ---------------------------------------------------------------------------

const {
  mockCreateByParameters,
  mockTake,
  mockSettleActivityRecord,
  mockResolveContributor,
  mockEnsureUserHasMigrated,
  mockAddContribution,
} = vi.hoisted(() => ({
  mockCreateByParameters: vi.fn(),
  mockTake: vi.fn(),
  mockSettleActivityRecord: vi.fn(),
  mockResolveContributor: vi.fn(),
  mockEnsureUserHasMigrated: vi.fn(),
  mockAddContribution: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: {
      createByParameters: mockCreateByParameters,
    },
  },
}));

// Barrel the listener imports settleActivityRecord/pendingActivityContext
// from (Implementation Note 1.2: the sibling `service/activity.ts` file
// shadows the `service/activity/` directory, so the real source imports via
// `~/server/service/activity/index`, not the bare `~/server/service/activity`
// -- the mock specifier below must match that exactly for Vitest to intercept
// the real import).
vi.mock('~/server/service/activity/index', () => ({
  pendingActivityContext: { take: mockTake },
  settleActivityRecord: mockSettleActivityRecord,
}));

vi.mock(
  '~/features/contribution-graph/server/services/contribution-migration-service',
  () => ({
    resolveContributor: mockResolveContributor,
    ensureUserHasMigrated: mockEnsureUserHasMigrated,
  }),
);

vi.mock(
  '~/features/contribution-graph/server/services/contribution-service',
  () => ({
    addContribution: mockAddContribution,
  }),
);

// ---------------------------------------------------------------------------
// Import ActivityService AFTER mock declarations (still runs before tests).
// ---------------------------------------------------------------------------
import ActivityService from './activity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a minimal Crowi mock wired to a real EventEmitter for activityEvent.
 *
 * `auditLogEnabled` controls whether the gate applies:
 *   - false (default): only AllEssentialActions are allowed.
 *   - true with empty additional/no group: blocks all non-essential actions.
 *
 * The service's own shoudUpdateActivity/getAvailableActions reads from
 * crowi.configManager, so we control availability through configManager mocks.
 */
function makeCrowi(opts: { auditLogEnabled?: boolean } = {}) {
  const { auditLogEnabled = false } = opts;
  const activityEmitter = new EventEmitter();

  const crowi = mock<Crowi>({
    events: {
      // Tier-2 cast (essential-test-patterns): we need a real EventEmitter so
      // listeners actually fire.  Only this one field is cast; the outer mock
      // remains type-safe via mock<Crowi>().
      activity: activityEmitter as unknown as typeof crowi.events.activity,
    },
    configManager: {
      getConfig: vi.fn().mockImplementation((key: string) => {
        if (key === 'app:auditLogEnabled') return auditLogEnabled;
        if (key === 'app:auditLogActionGroupSize') return 'SMALL'; // SmallActionGroup
        if (key === 'app:auditLogAdditionalActions') return '';
        if (key === 'app:auditLogExcludeActions') return '';
        return undefined;
      }),
    },
    activityService: {
      // The service's createActivity reads crowi.activityService.shoudUpdateActivity
      // (self-reference through crowi). We provide a real implementation here.
      shoudUpdateActivity: vi.fn().mockImplementation((_action: string) => {
        // Placeholder stub.  Individual tests override this with
        // .mockImplementation(...) to wire it to the real service.shoudUpdateActivity
        // after construction, so the createActivity gate uses the actual logic.
        return undefined;
      }),
    },
  });

  return { crowi, activityEmitter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no valid contributor found, so the contribution block's "warn"
  // branch runs instead of throwing on an unmocked user shape. Individual
  // tests only care that resolveContributor was *called* (ordering), not
  // its resolution.
  mockResolveContributor.mockResolvedValue(null);
});

describe('ActivityService.createActivity', () => {
  it('calls prisma.activities.createByParameters and returns the activity when gate passes (essential action)', async () => {
    const fakeActivity = {
      _id: 'id-1',
      action: SupportedAction.ACTION_PAGE_CREATE,
    };
    mockCreateByParameters.mockResolvedValueOnce(fakeActivity);

    const { crowi } = makeCrowi();
    const service = new ActivityService(crowi);

    // Wire the crowi.activityService.shoudUpdateActivity to the real service method
    // so createActivity's internal self-reference works correctly.
    (
      crowi.activityService?.shoudUpdateActivity as ReturnType<typeof vi.fn>
    ).mockImplementation((action: string) =>
      service.shoudUpdateActivity(
        action as (typeof SupportedAction)[keyof typeof SupportedAction],
      ),
    );

    const params = {
      action: SupportedAction.ACTION_PAGE_CREATE,
      ip: '1.2.3.4',
      endpoint: '/test',
    };
    const result = await service.createActivity(params);

    expect(mockCreateByParameters).toHaveBeenCalledTimes(1);
    expect(mockCreateByParameters).toHaveBeenCalledWith(params);
    expect(result).toEqual(fakeActivity);
  });

  it('returns null and does not call prisma when gate blocks (non-essential action)', async () => {
    const { crowi } = makeCrowi(); // auditLogEnabled=false → only AllEssentialActions
    const service = new ActivityService(crowi);

    // Wire self-reference to real gate
    (
      crowi.activityService?.shoudUpdateActivity as ReturnType<typeof vi.fn>
    ).mockImplementation((action: string) =>
      service.shoudUpdateActivity(
        action as (typeof SupportedAction)[keyof typeof SupportedAction],
      ),
    );

    // ACTION_USER_PERSONAL_SETTINGS_UPDATE is a SupportedAction but NOT in
    // AllEssentialActions, so it is blocked when auditLogEnabled=false.
    const params = {
      action: SupportedAction.ACTION_USER_PERSONAL_SETTINGS_UPDATE,
      ip: '1.2.3.4',
      endpoint: '/test',
    };
    const result = await service.createActivity(params);

    expect(mockCreateByParameters).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('swallows prisma errors and returns null (recording failure must not stop main flow)', async () => {
    mockCreateByParameters.mockRejectedValueOnce(new Error('DB error'));

    const { crowi } = makeCrowi();
    const service = new ActivityService(crowi);

    (
      crowi.activityService?.shoudUpdateActivity as ReturnType<typeof vi.fn>
    ).mockImplementation((action: string) =>
      service.shoudUpdateActivity(
        action as (typeof SupportedAction)[keyof typeof SupportedAction],
      ),
    );

    const params = {
      action: SupportedAction.ACTION_PAGE_CREATE,
      ip: '1.2.3.4',
      endpoint: '/test',
    };
    // Must NOT throw — error is swallowed with logger.error, then returns null
    const result = await service.createActivity(params);

    expect(mockCreateByParameters).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });
});

describe('ActivityService activityEvent("update") handler', () => {
  it('takes the pending context synchronously (before any await), settles with the injected shouldPersist=true, runs contribution before settle, and emits "updated" on a non-null settle result (in-gate)', async () => {
    const fakeContext = {
      ip: '1.2.3.4',
      endpoint: '/test',
      userId: 'actor-user-id',
      username: 'alice',
      createdAt: new Date('2026-07-08T00:00:00.000Z'),
    };
    const fakeActivity = {
      _id: 'id-2',
      action: SupportedAction.ACTION_PAGE_UPDATE,
    };
    mockTake.mockReturnValue(fakeContext);
    mockSettleActivityRecord.mockResolvedValue(fakeActivity);

    const { crowi, activityEmitter } = makeCrowi();
    const service = new ActivityService(crowi);
    // Deterministic control over record-eligibility -- the gate itself
    // (getAvailableActions/shoudUpdateActivity) is covered elsewhere.
    vi.spyOn(service, 'shoudUpdateActivity').mockReturnValue(true);

    const updatedHandler = vi.fn();
    activityEmitter.on('updated', updatedHandler);

    const activityId = 'some-activity-id';
    // contributor is destructured out before calling settleActivityRecord
    const parameters = {
      action: SupportedAction.ACTION_PAGE_UPDATE,
      contributor: 'user-1',
    };
    const target = { _id: 'page-id' };

    activityEmitter.emit('update', activityId, parameters, target);

    // take() is the very first statement in the handler, before any `await`
    // -- so by the time emit() returns control (still fully synchronous),
    // it must already have fired. If a regression moved the take() call
    // after the contribution await, this assertion would fail here (before
    // the listener has had any chance to resume from a microtask).
    expect(mockTake).toHaveBeenCalledWith(activityId);

    // Wait for the async listener to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    const { contributor: _contributor, ...activityParameters } = parameters;

    expect(mockSettleActivityRecord).toHaveBeenCalledTimes(1);
    expect(mockSettleActivityRecord).toHaveBeenCalledWith({
      activityId,
      shouldPersist: true,
      context: fakeContext,
      activityParameters,
    });

    // Contribution (resolveContributor) must run BEFORE settle (Req 2.4).
    expect(mockResolveContributor).toHaveBeenCalledWith(activityId, 'user-1');
    expect(mockResolveContributor.mock.invocationCallOrder[0]).toBeLessThan(
      mockSettleActivityRecord.mock.invocationCallOrder[0],
    );

    expect(updatedHandler).toHaveBeenCalledTimes(1);
    expect(updatedHandler).toHaveBeenCalledWith(fakeActivity, target);
  });

  it('creates nothing and does not emit "updated" when settleActivityRecord returns null (out-of-gate: no row-creating side effect)', async () => {
    mockTake.mockReturnValue(undefined);
    mockSettleActivityRecord.mockResolvedValue(null);

    const { crowi, activityEmitter } = makeCrowi(); // auditLogEnabled=false → only essential
    const service = new ActivityService(crowi);
    vi.spyOn(service, 'shoudUpdateActivity').mockReturnValue(false);

    const updatedHandler = vi.fn();
    activityEmitter.on('updated', updatedHandler);

    const activityId = 'blocked-activity-id';
    // Non-essential, non-contribution action → gate blocks it and no
    // contribution processing is expected either.
    const parameters = {
      action: SupportedAction.ACTION_USER_PERSONAL_SETTINGS_UPDATE,
    };
    const target = { _id: 'page-id' };

    activityEmitter.emit('update', activityId, parameters, target);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockSettleActivityRecord).toHaveBeenCalledTimes(1);
    expect(mockSettleActivityRecord).toHaveBeenCalledWith(
      expect.objectContaining({ shouldPersist: false }),
    );
    expect(mockCreateByParameters).not.toHaveBeenCalled();
    expect(updatedHandler).not.toHaveBeenCalled();
  });

  it('does not emit "updated" when settleActivityRecord throws (record failure must not stop the flow, and must not notify)', async () => {
    mockTake.mockReturnValue(undefined);
    mockSettleActivityRecord.mockRejectedValue(new Error('DB error'));

    const { crowi, activityEmitter } = makeCrowi();
    const service = new ActivityService(crowi);
    vi.spyOn(service, 'shoudUpdateActivity').mockReturnValue(true);

    const updatedHandler = vi.fn();
    activityEmitter.on('updated', updatedHandler);

    const activityId = 'errored-activity-id';
    const parameters = { action: SupportedAction.ACTION_PAGE_UPDATE };
    const target = { _id: 'page-id' };

    // Must not throw/crash the emitter -- the error is swallowed.
    expect(() =>
      activityEmitter.emit('update', activityId, parameters, target),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(updatedHandler).not.toHaveBeenCalled();
  });

  it('passes the actor id from the taken context as `user` to the notify construction, while the emitted "updated" activity keeps the original settle result (actor-exclusion wiring — Req 2.3)', async () => {
    const fakeContext = {
      ip: '1.2.3.4',
      endpoint: '/test',
      userId: 'actor-user-id',
      username: 'alice',
      createdAt: new Date('2026-07-08T00:00:00.000Z'),
    };
    const fakeActivity = {
      _id: 'id-3',
      action: SupportedAction.ACTION_PAGE_CREATE,
      targetModel: 'Page',
      target: 'page-id',
    };
    mockTake.mockReturnValue(fakeContext);
    mockSettleActivityRecord.mockResolvedValue(fakeActivity);

    const { crowi, activityEmitter } = makeCrowi();
    const service = new ActivityService(crowi);
    vi.spyOn(service, 'shoudUpdateActivity').mockReturnValue(true);

    const innerPreNotify = vi.fn();
    const generatePreNotify = vi.fn().mockReturnValue(innerPreNotify);
    const updatedHandler = vi.fn();
    activityEmitter.on('updated', updatedHandler);

    const activityId = 'some-activity-id';
    const parameters = { action: SupportedAction.ACTION_PAGE_CREATE };
    const target = { _id: 'page-id' };

    activityEmitter.emit(
      'update',
      activityId,
      parameters,
      target,
      generatePreNotify,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The notify-construction input is the settle result with the actor id
    // attached as `user` (so pre-notify's getIdForRef(actionUser) still
    // excludes the actor -- Implementation Note "2→5").
    expect(generatePreNotify).toHaveBeenCalledWith(
      { ...fakeActivity, user: 'actor-user-id' },
      undefined,
    );

    // The object actually emitted on 'updated' is the ORIGINAL settle
    // result -- untouched, no injected `user` -- since the in-app-notification
    // consumer never reads `.user` off it (only _id/action/targetModel/target/snapshot).
    expect(updatedHandler).toHaveBeenCalledWith(
      fakeActivity,
      target,
      innerPreNotify,
    );
  });
});

describe('ActivityService.createTtlIndex (Mongoose path remains intact)', () => {
  it('calls Activity.createIndexes via Mongoose (not Prisma)', async () => {
    const createIndexesSpy = vi
      .spyOn(Activity, 'createIndexes')
      // Resolve immediately without hitting MongoDB
      .mockResolvedValueOnce(undefined);

    // Also stub mongoose.connection.collection to avoid a real DB connection.
    // createTtlIndex calls mongoose.connection.collection('activities') after
    // createIndexes. We stub it to return a minimal collection-like object so
    // the whole method completes without timing out.
    const mockMongoose = await import('mongoose');
    const collectionStub = {
      indexes: vi.fn().mockResolvedValue([]),
      createIndex: vi.fn().mockResolvedValue(undefined),
      dropIndex: vi.fn().mockResolvedValue(undefined),
    };
    const collectionSpy = vi
      .spyOn(mockMongoose.default.connection, 'collection')
      .mockReturnValue(
        collectionStub as unknown as ReturnType<
          typeof mockMongoose.default.connection.collection
        >,
      );

    const { crowi } = makeCrowi();
    const service = new ActivityService(crowi);

    await service.createTtlIndex();

    expect(createIndexesSpy).toHaveBeenCalledTimes(1);

    createIndexesSpy.mockRestore();
    collectionSpy.mockRestore();
  });
});
