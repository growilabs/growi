/**
 * Unit tests for ActivityService create/update routing (Task 3.2).
 *
 * Observable contracts:
 *   1. createActivity calls prisma.activities.createByParameters with params
 *      when shoudUpdateActivity gate passes.
 *   2. createActivity returns null and does not call prisma when gate blocks
 *      (action not in available actions).
 *   3. activityEvent 'update' handler calls prisma.activities.updateByParameters
 *      when gate passes (essential action).
 *   4. activityEvent 'update' handler skips prisma when gate blocks (non-essential
 *      action), and does NOT emit 'updated'.
 *   5. createTtlIndex still calls Activity.createIndexes (Mongoose, stays intact).
 *
 * Gate behaviour recap:
 *   - shoudUpdateActivity calls getAvailableActions().includes(action).
 *   - When auditLogEnabled=false, getAvailableActions returns AllEssentialActions.
 *   - AllEssentialActions includes ACTION_PAGE_CREATE / ACTION_PAGE_UPDATE.
 *   - An action outside AllEssentialActions (e.g. ACTION_USER_PERSONAL_SETTINGS_UPDATE)
 *     will be blocked when auditLogEnabled=false.
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
// vi.mock factory (which is hoisted above all imports by Vitest).
// ---------------------------------------------------------------------------

const { mockCreateByParameters, mockUpdateByParameters } = vi.hoisted(() => ({
  mockCreateByParameters: vi.fn(),
  mockUpdateByParameters: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mock: ~/utils/prisma
// ---------------------------------------------------------------------------

vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: {
      createByParameters: mockCreateByParameters,
      updateByParameters: mockUpdateByParameters,
    },
  },
}));

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
  it('calls prisma.activities.updateByParameters and emits "updated" when gate passes (essential action)', async () => {
    const fakeActivity = {
      _id: 'id-2',
      action: SupportedAction.ACTION_PAGE_UPDATE,
    };
    mockUpdateByParameters.mockResolvedValueOnce(fakeActivity);

    const { crowi, activityEmitter } = makeCrowi();
    // Service constructor registers the listener on activityEmitter as a side effect.
    // The variable is prefixed with _ because we only need the construction side-effect.
    const _service = new ActivityService(crowi);

    const updatedHandler = vi.fn();
    activityEmitter.on('updated', updatedHandler);

    const activityId = 'some-activity-id';
    // contributor is destructured out before calling updateByParameters
    const parameters = {
      action: SupportedAction.ACTION_PAGE_UPDATE,
      contributor: 'user-1',
    };
    const target = { _id: 'page-id' };

    activityEmitter.emit('update', activityId, parameters, target);

    // Wait for the async listener to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    const { contributor: _contributor, ...activityParameters } = parameters;

    expect(mockUpdateByParameters).toHaveBeenCalledTimes(1);
    expect(mockUpdateByParameters).toHaveBeenCalledWith(
      activityId,
      activityParameters,
    );

    expect(updatedHandler).toHaveBeenCalledTimes(1);
    expect(updatedHandler).toHaveBeenCalledWith(fakeActivity, target);
  });

  it('skips prisma and does not emit "updated" when gate blocks (non-essential action)', async () => {
    const { crowi, activityEmitter } = makeCrowi(); // auditLogEnabled=false → only essential
    // _service: only needed for side-effect (registering the event listener)
    const _service = new ActivityService(crowi);

    const updatedHandler = vi.fn();
    activityEmitter.on('updated', updatedHandler);

    const activityId = 'blocked-activity-id';
    // Non-essential action → gate blocks it
    const parameters = {
      action: SupportedAction.ACTION_USER_PERSONAL_SETTINGS_UPDATE,
    };
    const target = { _id: 'page-id' };

    activityEmitter.emit('update', activityId, parameters, target);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockUpdateByParameters).not.toHaveBeenCalled();
    expect(updatedHandler).not.toHaveBeenCalled();
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
