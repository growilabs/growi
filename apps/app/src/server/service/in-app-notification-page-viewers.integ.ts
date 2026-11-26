import {
  GroupType,
  type IPage,
  type IUserHasId,
  PageGrant,
  SubscriptionStatusType,
} from '@growi/core';
import mongoose, { type HydratedDocument, Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import {
  SupportedAction,
  type SupportedActionType,
  SupportedTargetModel,
} from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { preNotifyService } from '~/server/service/pre-notify';
import { prisma } from '~/utils/prisma';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PREFIX = `/in-app-notification-page-viewers-integ-${WORKER_ID}`;

describe('in-app notifications about a page reach only subscribers who can view it', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let actor: HydratedDocument<IUserHasId>;
  let member: HydratedDocument<IUserHasId>;
  let outsider: HydratedDocument<IUserHasId>;
  let userGroupId: Types.ObjectId;

  const createUser = (role: string) => {
    const username = `ianpv-${role}-${WORKER_ID}`;
    return mongoose.model<IUserHasId>('User').create({
      name: username,
      username,
      email: `${username}@example.com`,
      status: 2,
    });
  };

  // Subscribed directly: the outsider stands for a user who subscribed while the
  // page was still viewable and lost access afterwards.
  const createSubscribedPage = async (
    name: string,
    grant: Partial<PageDocument>,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.create({
      path: `${PREFIX}/${name}`,
      creator: actor._id,
      lastUpdateUser: actor._id,
      ...grant,
    });
    await Promise.all(
      [member, outsider].map((user) =>
        Subscription.subscribeByPageId(
          new Types.ObjectId(user._id),
          page._id,
          SubscriptionStatusType.SUBSCRIBE,
        ),
      ),
    );
    return page;
  };

  const groupOnly = (): Partial<PageDocument> => ({
    grant: PageGrant.GRANT_USER_GROUP,
    grantedGroups: [{ item: userGroupId, type: GroupType.userGroup }],
  });

  const notifiedUsernames = async (
    page: HydratedDocument<PageDocument>,
  ): Promise<string[]> => {
    const notifications = await InAppNotification.find({
      target: page._id,
    }).lean();
    const recipientIds = notifications.map((n) => String(n.user));
    return [member, outsider]
      .filter((user) => recipientIds.includes(String(user._id)))
      .map((user) => user.username);
  };

  // Awaits what the activity listener runs, so every notification is written
  // before the test reads them.
  const deliver = async (
    action: SupportedActionType,
    page: HydratedDocument<PageDocument>,
    eventTarget: IPage,
  ): Promise<void> => {
    const activity = await crowi.activityService.createActivity({
      action,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: page,
      user: String(actor._id),
      snapshot: { username: actor.username },
    });
    if (activity == null) {
      throw new Error(`the ${action} activity was not recorded`);
    }
    const service = crowi.inAppNotificationService;
    if (service == null) {
      throw new Error('inAppNotificationService is not initialized');
    }
    await service.createInAppNotification(
      activity,
      eventTarget,
      preNotifyService.generatePreNotify(activity),
    );
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    actor = await createUser('actor');
    member = await createUser('member');
    outsider = await createUser('outsider');

    const userGroup = await UserGroup.create({ name: `ianpv-g-${WORKER_ID}` });
    userGroupId = userGroup._id;
    await UserGroupRelation.create([
      { relatedGroup: userGroupId, relatedUser: actor._id },
      { relatedGroup: userGroupId, relatedUser: member._id },
    ]);
  });

  afterAll(async () => {
    const userIds = [actor._id, member._id, outsider._id];
    await InAppNotification.deleteMany({ user: { $in: userIds } });
    await Subscription.deleteMany({ user: { $in: userIds } });
    await prisma.activities.deleteMany({
      where: { userId: String(actor._id) },
    });
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}/`) });
    await UserGroupRelation.deleteMany({ relatedGroup: userGroupId });
    await UserGroup.deleteOne({ _id: userGroupId });
    await mongoose.model('User').deleteMany({ _id: { $in: userIds } });
  });

  it('notifies every subscriber of a public page', async () => {
    const page = await createSubscribedPage('public', {
      grant: PageGrant.GRANT_PUBLIC,
    });

    await deliver(SupportedAction.ACTION_PAGE_BOOKMARK, page, page);

    expect(await notifiedUsernames(page)).toEqual([
      member.username,
      outsider.username,
    ]);
  });

  it('does not notify a subscriber outside the group of a group-only page', async () => {
    const page = await createSubscribedPage('bookmarked', groupOnly());

    await deliver(SupportedAction.ACTION_PAGE_BOOKMARK, page, page);

    expect(await notifiedUsernames(page)).toEqual([member.username]);
  });

  it('applies the same rule to a page update, whose event carries no grant', async () => {
    const page = await createSubscribedPage('updated', groupOnly());
    // The shape emitPageUpdateActivity emits; activity events are not type-checked.
    const updateEventTarget = {
      path: page.path,
      creator: actor._id,
    } as unknown as IPage;

    await deliver(SupportedAction.ACTION_PAGE_UPDATE, page, updateEventTarget);

    expect(await notifiedUsernames(page)).toEqual([member.username]);
  });
});
