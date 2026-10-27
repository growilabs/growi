import type { IUserHasId } from '@growi/core';
import { Origin } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { subscribeRuleNames } from '~/interfaces/in-app-notification';
import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import type { PageDocument } from '~/server/models/page';
import type { GlobalNotificationService } from '~/server/service/global-notification';
import type { UserNotificationService } from '~/server/service/user-notification';
import type { IYjsService } from '~/server/service/yjs';

import { runAfterHumanCreate, runAfterHumanUpdate } from './human-save-effects';

const { yjsService } = vi.hoisted(() => ({
  yjsService: { syncWithTheLatestRevisionForce: vi.fn() },
}));
vi.mock('~/server/service/yjs', () => ({
  getYjsService: (): Pick<IYjsService, 'syncWithTheLatestRevisionForce'> =>
    yjsService,
}));

type InAppNotificationService = NonNullable<Crowi['inAppNotificationService']>;

const setup = () => {
  const calls: string[] = [];
  const globalNotificationService = mock<GlobalNotificationService>();
  globalNotificationService.fire.mockImplementation((event) => {
    calls.push(`global:${event}`);
    return Promise.resolve();
  });
  const userNotificationService = mock<UserNotificationService>();
  userNotificationService.fire.mockImplementation(() => {
    calls.push('user');
    return Promise.resolve([]);
  });
  const inAppNotificationService = mock<InAppNotificationService>();
  inAppNotificationService.createSubscription.mockImplementation(() => {
    calls.push('subscription');
    return Promise.resolve();
  });
  yjsService.syncWithTheLatestRevisionForce.mockImplementation(() => {
    calls.push('yjs');
    return Promise.resolve({});
  });
  const crowi = mock<Crowi>({
    globalNotificationService,
    userNotificationService,
    inAppNotificationService,
  });
  return {
    crowi,
    calls,
    globalNotificationService,
    userNotificationService,
    inAppNotificationService,
  };
};

describe('runAfterHumanUpdate', () => {
  const pageId = new Types.ObjectId().toString();
  const page = mock<HydratedDocument<PageDocument>>({ path: '/human-save' });
  const user = mock<IUserHasId>();

  beforeEach(() => {
    yjsService.syncWithTheLatestRevisionForce.mockReset();
  });

  it.each([
    ['view', Origin.View],
    ['no origin', undefined],
  ])('replaces the collaborative draft and then sends the edit notification when saved from %s', async (_label, origin) => {
    const { crowi, calls } = setup();

    await runAfterHumanUpdate(crowi, {
      pageId,
      page,
      user,
      origin,
      previousRevision: null,
    });

    expect(yjsService.syncWithTheLatestRevisionForce).toHaveBeenCalledWith(
      pageId,
    );
    expect(calls).toEqual([
      'yjs',
      `global:${GlobalNotificationSettingEvent.PAGE_EDIT}`,
    ]);
  });

  it('does not touch the collaborative draft when saved from the editor', async () => {
    const { crowi, calls, globalNotificationService } = setup();

    await runAfterHumanUpdate(crowi, {
      pageId,
      page,
      user,
      origin: Origin.Editor,
      previousRevision: null,
    });

    expect(yjsService.syncWithTheLatestRevisionForce).not.toHaveBeenCalled();
    expect(globalNotificationService.fire).toHaveBeenCalledWith(
      GlobalNotificationSettingEvent.PAGE_EDIT,
      page,
      user,
    );
    expect(calls).toEqual([
      `global:${GlobalNotificationSettingEvent.PAGE_EDIT}`,
    ]);
  });

  it('sends the Slack notification with the previous revision only when Slack is enabled', async () => {
    const { crowi, userNotificationService } = setup();
    const previousRevision = { body: 'before' };

    await runAfterHumanUpdate(crowi, {
      pageId,
      page,
      user,
      origin: Origin.Editor,
      previousRevision,
      isSlackEnabled: true,
      slackChannels: 'general',
    });
    await runAfterHumanUpdate(crowi, {
      pageId,
      page,
      user,
      origin: Origin.Editor,
      previousRevision,
      isSlackEnabled: false,
      slackChannels: 'general',
    });

    expect(userNotificationService.fire).toHaveBeenCalledTimes(1);
    expect(userNotificationService.fire).toHaveBeenCalledWith(
      page,
      user,
      'general',
      'update',
      { previousRevision },
    );
  });

  it('sends the Slack notification without an option when there is no previous revision', async () => {
    const { crowi, userNotificationService } = setup();

    await runAfterHumanUpdate(crowi, {
      pageId,
      page,
      user,
      origin: Origin.Editor,
      previousRevision: null,
      isSlackEnabled: true,
      slackChannels: 'general',
    });

    expect(userNotificationService.fire).toHaveBeenCalledWith(
      page,
      user,
      'general',
      'update',
      undefined,
    );
  });

  it('still sends the Slack notification when the global notification fails', async () => {
    const { crowi, globalNotificationService, userNotificationService } =
      setup();
    globalNotificationService.fire.mockRejectedValue(new Error('smtp down'));

    await expect(
      runAfterHumanUpdate(crowi, {
        pageId,
        page,
        user,
        origin: Origin.Editor,
        previousRevision: null,
        isSlackEnabled: true,
        slackChannels: 'general',
      }),
    ).resolves.toBeUndefined();

    expect(userNotificationService.fire).toHaveBeenCalledTimes(1);
  });
});

describe('runAfterHumanCreate', () => {
  const pageId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const page = mock<HydratedDocument<PageDocument>>({
    _id: pageId,
    path: '/human-create',
  });
  const user = mock<IUserHasId>({ _id: userId.toString() });

  it('sends the create notification, the Slack notification and then subscribes the creator, in that order', async () => {
    const {
      crowi,
      calls,
      globalNotificationService,
      userNotificationService,
      inAppNotificationService,
    } = setup();

    await runAfterHumanCreate(crowi, {
      page,
      user,
      isSlackEnabled: true,
      slackChannels: 'general',
    });

    expect(globalNotificationService.fire).toHaveBeenCalledWith(
      GlobalNotificationSettingEvent.PAGE_CREATE,
      page,
      user,
    );
    expect(userNotificationService.fire).toHaveBeenCalledWith(
      page,
      user,
      'general',
      'create',
    );
    expect(inAppNotificationService.createSubscription).toHaveBeenCalledWith(
      userId.toString(),
      pageId,
      subscribeRuleNames.PAGE_CREATE,
    );
    expect(calls).toEqual([
      `global:${GlobalNotificationSettingEvent.PAGE_CREATE}`,
      'user',
      'subscription',
    ]);
  });

  it('subscribes the creator without a Slack notification when Slack is disabled, even if the global notification fails', async () => {
    const {
      crowi,
      globalNotificationService,
      userNotificationService,
      inAppNotificationService,
    } = setup();
    globalNotificationService.fire.mockRejectedValue(new Error('smtp down'));

    await runAfterHumanCreate(crowi, { page, user });

    expect(userNotificationService.fire).not.toHaveBeenCalled();
    expect(inAppNotificationService.createSubscription).toHaveBeenCalledTimes(
      1,
    );
  });
});
