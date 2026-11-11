import { EventEmitter } from 'node:events';
import type { IPage, IUserHasId } from '@growi/core';
import type { Request, RequestHandler } from 'express';
import type { HydratedDocument } from 'mongoose';
import mongoose, { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import type { GlobalNotificationService } from '~/server/service/global-notification';
import type { UserNotificationService } from '~/server/service/user-notification';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { createPageHandlersFactory } from './create-page';
import { updatePageHandlersFactory } from './update-page';

// Plain stubs: the route serializes the page, which a vitest-mock-extended
// proxy does not survive.
const asPageDocument = (stub: Record<string, unknown>) =>
  stub as unknown as HydratedDocument<PageDocument>;

// A mongoose user document does not survive being wrapped in a mock proxy.
const asRequest = (stub: Record<string, unknown>) => stub as unknown as Request;

const TEST_USERNAME = 'human-save-notifications-user';

const CHANGE_PROPOSAL_SWITCHES = [
  'app:changeProposalEnabled',
  'changeProposal:isEditEnabled',
  'changeProposal:isCreateEnabled',
  'changeProposal:isMoveEnabled',
] as const;

type NotificationCounts = {
  readonly activity: number;
  readonly global: number;
  readonly user: number;
  readonly subscription: number;
};

describe('human saves send the same notifications whether Change Proposal writing is enabled or not', () => {
  let crowi: Crowi;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;

  beforeAll(async () => {
    crowi = await getInstance();
    testUser = await crowi.models.User.create({
      name: 'Human Save Notifications User',
      username: TEST_USERNAME,
      email: 'human-save-notifications@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);
  }, 120_000);

  let restoreServices: () => void = () => {};

  afterEach(() => {
    restoreServices();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
    await configManager.updateConfigs(
      Object.fromEntries(
        CHANGE_PROPOSAL_SWITCHES.map((key) => [key, undefined]),
      ),
      { removeIfUndefined: true },
    );
  });

  const setChangeProposalWriting = async (enabled: boolean): Promise<void> => {
    await configManager.updateConfigs(
      Object.fromEntries(CHANGE_PROPOSAL_SWITCHES.map((key) => [key, enabled])),
    );
  };

  // The integration Crowi does not set up the notification services, so they
  // are swapped for mocks and put back after each run. The activity emitter is
  // swapped too, so the emits are counted without settling real rows.
  const spyNotifications = () => {
    const inAppNotificationService = crowi.inAppNotificationService;
    if (inAppNotificationService == null) {
      throw new Error('inAppNotificationService is not initialized');
    }
    const originals = {
      global: crowi.globalNotificationService,
      user: crowi.userNotificationService,
      activity: crowi.events.activity,
    };
    restoreServices = () => {
      crowi.globalNotificationService = originals.global;
      crowi.userNotificationService = originals.user;
      crowi.events.activity = originals.activity;
    };
    const activityActions: unknown[] = [];
    const activityEvent = new EventEmitter();
    activityEvent.on(
      'update',
      (_id: string, parameters: { action: unknown }) => {
        activityActions.push(parameters.action);
      },
    );
    crowi.events.activity = activityEvent;
    const globalNotificationService = mock<GlobalNotificationService>();
    globalNotificationService.fire.mockResolvedValue();
    const userNotificationService = mock<UserNotificationService>();
    userNotificationService.fire.mockResolvedValue([]);
    crowi.globalNotificationService = globalNotificationService;
    crowi.userNotificationService = userNotificationService;
    return {
      activityActions,
      global: globalNotificationService.fire,
      user: userNotificationService.fire,
      subscription: vi
        .spyOn(inAppNotificationService, 'createSubscription')
        .mockResolvedValue(undefined),
    };
  };

  const makeRes = (): ApiV3Response =>
    mock<ApiV3Response>({
      locals: { activity: { _id: new Types.ObjectId().toString() } },
      apiv3: vi.fn(),
      apiv3Err: vi.fn(),
    });

  const runUpdate = async (): Promise<NotificationCounts> => {
    const spies = spyNotifications();
    const Page = mongoose.model<IPage, PageModel>('Page');
    const pageId = new Types.ObjectId();
    const revisionId = new Types.ObjectId();
    const currentPage = asPageDocument({
      _id: pageId,
      path: '/human-save-notifications-update',
      grant: 1,
      revision: revisionId,
      isUpdatable: vi.fn().mockResolvedValue(true),
    });
    vi.spyOn(Page, 'count').mockResolvedValue(1);
    vi.spyOn(Page, 'findByIdAndViewer').mockResolvedValue(currentPage);
    vi.spyOn(prisma.revisions, 'findUnique').mockResolvedValue(null);
    vi.spyOn(crowi.pageService, 'updatePage').mockResolvedValue(
      asPageDocument({
        _id: pageId,
        path: currentPage.path,
        creator: testUserId,
        revision: new Types.ObjectId(),
      }),
    );

    const res = makeRes();
    const handlers = updatePageHandlersFactory(crowi);
    await (handlers[handlers.length - 1] as RequestHandler)(
      asRequest({
        method: 'PUT',
        user: testUser,
        body: {
          pageId: pageId.toString(),
          revisionId: revisionId.toString(),
          body: 'updated body',
          origin: 'editor',
          isSlackEnabled: true,
          slackChannels: 'general',
        },
      }),
      res,
      () => {},
    );

    expect(res.apiv3).toHaveBeenCalledTimes(1);
    // The effects run after the response without being awaited.
    await vi.waitFor(() => {
      expect(spies.user).toHaveBeenCalled();
    });
    return {
      activity: spies.activityActions.length,
      global: spies.global.mock.calls.length,
      user: spies.user.mock.calls.length,
      subscription: spies.subscription.mock.calls.length,
    };
  };

  const runCreate = async (): Promise<NotificationCounts> => {
    const spies = spyNotifications();
    const pageId = new Types.ObjectId();
    vi.spyOn(crowi.pageService, 'create').mockResolvedValue(
      asPageDocument({
        _id: pageId,
        id: pageId.toString(),
        path: '/human-save-notifications-create',
        creator: testUserId,
        revision: new Types.ObjectId(),
      }),
    );
    vi.spyOn(prisma.pagetagrelations, 'updatePageTags').mockResolvedValue(
      undefined,
    );
    vi.spyOn(prisma.pagetagrelations, 'listTagNamesByPage').mockResolvedValue(
      [],
    );

    const res = makeRes();
    const handlers = createPageHandlersFactory(crowi);
    await (handlers[handlers.length - 1] as RequestHandler)(
      asRequest({
        method: 'POST',
        user: testUser,
        body: {
          path: '/human-save-notifications-create',
          body: 'created body',
          isSlackEnabled: true,
          slackChannels: 'general',
        },
      }),
      res,
      () => {},
    );

    expect(res.apiv3).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(spies.subscription).toHaveBeenCalled();
    });
    return {
      activity: spies.activityActions.length,
      global: spies.global.mock.calls.length,
      user: spies.user.mock.calls.length,
      subscription: spies.subscription.mock.calls.length,
    };
  };

  it('records one update activity and sends one edit notification and one Slack notification per update in both states', async () => {
    await setChangeProposalWriting(false);
    const whenDisabled = await runUpdate();
    restoreServices();
    vi.restoreAllMocks();
    await setChangeProposalWriting(true);
    const whenEnabled = await runUpdate();

    expect(whenDisabled).toEqual({
      activity: 1,
      global: 1,
      user: 1,
      subscription: 0,
    });
    expect(whenEnabled).toEqual(whenDisabled);
  });

  it('records one create activity and sends one create notification, one Slack notification and one subscription per create in both states', async () => {
    await setChangeProposalWriting(false);
    const whenDisabled = await runCreate();
    restoreServices();
    vi.restoreAllMocks();
    await setChangeProposalWriting(true);
    const whenEnabled = await runCreate();

    expect(whenDisabled).toEqual({
      activity: 1,
      global: 1,
      user: 1,
      subscription: 1,
    });
    expect(whenEnabled).toEqual(whenDisabled);
  });
});
