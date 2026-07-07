import EventEmitter from 'events';
import mongoose from 'mongoose';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import Activity from '~/server/models/activity';
import ActivityService from '~/server/service/activity';
import type { ConfigValues } from '~/server/service/config-manager/config-definition';

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('ActivityService', () => {
  let mockCrowi: DeepMockProxy<Crowi>;
  let activityService: ActivityService;
  let activityEvent: EventEmitter;

  const setConfig = (config: Partial<ConfigValues>) => {
    mockCrowi.configManager.getConfig.mockImplementation((key) => config[key]);
  };

  beforeEach(() => {
    activityEvent = new EventEmitter();
    mockCrowi = mockDeep<Crowi>();
    mockCrowi.events.activity = activityEvent;
    activityService = new ActivityService(mockCrowi);
    mockCrowi.activityService = activityService;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Activity.deleteMany({});
  });

  describe('createActivity()', () => {
    let createdListener: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      createdListener = vi.fn();
      activityEvent.on('created', createdListener);
    });

    it('should save the activity and notify "created" subscribers', async () => {
      const result = await activityService.createActivity({
        action: SupportedAction.ACTION_PAGE_CREATE,
      });

      expect(result).toMatchObject({
        action: SupportedAction.ACTION_PAGE_CREATE,
      });
      const saved = await Activity.findOne({
        action: SupportedAction.ACTION_PAGE_CREATE,
      });
      expect(saved).not.toBeNull();
      expect(createdListener).toHaveBeenCalledWith(
        expect.objectContaining({ action: SupportedAction.ACTION_PAGE_CREATE }),
      );
    });

    it('should return null without notifying when the action is not available', async () => {
      const result = await activityService.createActivity({
        action: SupportedAction.ACTION_PAGE_SUBSCRIBE,
      });

      expect(result).toBeNull();
      expect(createdListener).not.toHaveBeenCalled();
    });

    it('should return null without notifying when Activity creation throws', async () => {
      vi.spyOn(Activity, 'createByParameters').mockRejectedValue(
        new Error('DB error'),
      );

      const result = await activityService.createActivity({
        action: SupportedAction.ACTION_PAGE_CREATE,
      });

      expect(result).toBeNull();
      expect(createdListener).not.toHaveBeenCalled();
    });

    describe('when audit log is enabled', () => {
      // Each action is exclusive to its tier (absent from smaller groups) and non-essential,
      // so saving it proves the configured group size actually expands availability.
      it.each([
        {
          groupSize: ActionGroupSize.Small,
          action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
        },
        {
          groupSize: ActionGroupSize.Medium,
          action: SupportedAction.ACTION_PAGE_SUBSCRIBE,
        },
        {
          groupSize: ActionGroupSize.Large,
          action: SupportedAction.ACTION_ADMIN_APP_SETTINGS_UPDATE,
        },
      ])('should save a $groupSize-group action that is not essential', async ({
        groupSize,
        action,
      }) => {
        setConfig({
          'app:auditLogEnabled': true,
          'app:auditLogActionGroupSize': groupSize,
        });

        const result = await activityService.createActivity({ action });

        expect(result).toMatchObject({ action });
        expect(createdListener).toHaveBeenCalledTimes(1);
      });

      it('should save an action added via additionalActions even if it is outside the group', async () => {
        setConfig({
          'app:auditLogEnabled': true,
          'app:auditLogActionGroupSize': ActionGroupSize.Small,
          'app:auditLogAdditionalActions':
            SupportedAction.ACTION_PAGE_SUBSCRIBE,
        });

        const result = await activityService.createActivity({
          action: SupportedAction.ACTION_PAGE_SUBSCRIBE,
        });

        expect(result).toMatchObject({
          action: SupportedAction.ACTION_PAGE_SUBSCRIBE,
        });
        expect(createdListener).toHaveBeenCalledTimes(1);
      });

      it('should return null for an action removed via excludeActions', async () => {
        setConfig({
          'app:auditLogEnabled': true,
          'app:auditLogActionGroupSize': ActionGroupSize.Small,
          'app:auditLogExcludeActions':
            SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
        });

        const result = await activityService.createActivity({
          action: SupportedAction.ACTION_USER_LOGIN_WITH_LOCAL,
        });

        expect(result).toBeNull();
        expect(createdListener).not.toHaveBeenCalled();
      });
    });
  });

  // Activity updates and TTL-driven deletions reach Elasticsearch through the
  // change stream, so the update path and the TTL index are covered here too.
  describe("'update' event handling", () => {
    let updatedListener: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      updatedListener = vi.fn();
      activityEvent.on('updated', updatedListener);
    });

    it('should apply the update and notify "updated" subscribers for an available action', async () => {
      const activity = await Activity.createByParameters({
        action: SupportedAction.ACTION_PAGE_CREATE,
      });
      const target = new mongoose.Types.ObjectId();

      activityEvent.emit(
        'update',
        activity._id.toString(),
        { action: SupportedAction.ACTION_PAGE_CREATE, endpoint: '/updated' },
        target,
      );

      await vi.waitFor(() => expect(updatedListener).toHaveBeenCalled());

      const saved = await Activity.findById(activity._id);
      expect(saved?.endpoint).toBe('/updated');
      expect(updatedListener).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: '/updated' }),
        target,
      );
    });

    it('should pass the generated preNotify to "updated" subscribers', async () => {
      const activity = await Activity.createByParameters({
        action: SupportedAction.ACTION_PAGE_CREATE,
      });
      const target = new mongoose.Types.ObjectId();
      const preNotify = { notified: true };
      const generatePreNotify = vi.fn().mockReturnValue(preNotify);

      activityEvent.emit(
        'update',
        activity._id.toString(),
        { action: SupportedAction.ACTION_PAGE_CREATE },
        target,
        generatePreNotify,
      );

      await vi.waitFor(() => expect(updatedListener).toHaveBeenCalled());

      expect(updatedListener).toHaveBeenCalledWith(
        expect.objectContaining({ action: SupportedAction.ACTION_PAGE_CREATE }),
        target,
        preNotify,
      );
    });

    it('should neither update nor notify when the action is not available', async () => {
      const activity = await Activity.createByParameters({
        action: SupportedAction.ACTION_PAGE_CREATE,
      });

      activityEvent.emit('update', activity._id.toString(), {
        action: SupportedAction.ACTION_PAGE_SUBSCRIBE,
        endpoint: '/updated',
      });

      // Flush the event loop so any handler path — sync or async — has settled.
      await new Promise(setImmediate);

      const saved = await Activity.findById(activity._id);
      expect(saved?.endpoint).toBeUndefined();
      expect(updatedListener).not.toHaveBeenCalled();
    });
  });

  describe('createTtlIndex()', () => {
    const getCreatedAtIndex = async () => {
      const indexes = await mongoose.connection
        .collection('activities')
        .indexes();
      return indexes.find((i) => i.name === 'createdAt_1');
    };

    it('should create the TTL index with the configured expiration', async () => {
      setConfig({ 'app:activityExpirationSeconds': 1000 });

      await activityService.createTtlIndex();

      expect((await getCreatedAtIndex())?.expireAfterSeconds).toBe(1000);
    });

    it('should re-create the TTL index when the configured expiration changes', async () => {
      setConfig({ 'app:activityExpirationSeconds': 1000 });
      await activityService.createTtlIndex();

      setConfig({ 'app:activityExpirationSeconds': 2000 });
      await activityService.createTtlIndex();

      expect((await getCreatedAtIndex())?.expireAfterSeconds).toBe(2000);
    });
  });
});
