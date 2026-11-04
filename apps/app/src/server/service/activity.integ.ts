import EventEmitter from 'events';
import mongoose from 'mongoose';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import Activity from '~/server/models/activity';
import ActivityService from '~/server/service/activity';
import type { ConfigValues } from '~/server/service/config-manager/config-definition';
import { prisma } from '~/utils/prisma';

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
    it('should save the activity', async () => {
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
    });

    it('should return null when the action is not available', async () => {
      const result = await activityService.createActivity({
        action: SupportedAction.ACTION_PAGE_SUBSCRIBE,
      });

      expect(result).toBeNull();
    });

    it('should return null when Activity creation throws', async () => {
      // mockRestore/restoreAllMocks leaves this Prisma extension method as
      // `undefined` instead of restoring it (verified) — save/restore manually.
      const original = prisma.activities.createByParameters;
      prisma.activities.createByParameters = vi
        .fn()
        .mockRejectedValueOnce(new Error('DB error'));

      try {
        const result = await activityService.createActivity({
          action: SupportedAction.ACTION_PAGE_CREATE,
        });

        expect(result).toBeNull();
      } finally {
        prisma.activities.createByParameters = original;
      }
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
      });
    });
  });

  // 'update' event handling is covered by record-gate.integ.ts (Task 7.1-7.4)
  // via the real beginActivity() -> emit('update', ...) path. The old tests
  // here pre-created a row then emitted 'update' with the same id, which under
  // the lazy-fail-safe design just forces a duplicate-key settle failure.

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
