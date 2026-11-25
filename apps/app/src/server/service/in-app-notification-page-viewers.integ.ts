import {
  GroupType,
  type IUserHasId,
  PageGrant,
  SubscriptionStatusType,
} from '@growi/core';
import mongoose, { type HydratedDocument, Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { emitPageUpdateActivity } from '~/server/service/page-save/page-notifications';
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

  // The in-app notification listener is async and emit() does not wait for it.
  const notifiedUsernames = async (
    page: HydratedDocument<PageDocument>,
    expectedCount: number,
  ): Promise<string[]> => {
    for (let i = 0; i < 40; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: polling
      const count = await InAppNotification.countDocuments({
        target: page._id,
      });
      if (count >= expectedCount) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // give a wrongly addressed notification time to land
    await new Promise((resolve) => setTimeout(resolve, 300));
    const notifications = await InAppNotification.find({
      target: page._id,
    }).lean();
    const recipientIds = notifications.map((n) => String(n.user));
    return [member, outsider]
      .filter((user) => recipientIds.includes(String(user._id)))
      .map((user) => user.username);
  };

  const emitBookmark = async (page: HydratedDocument<PageDocument>) => {
    const activity = await crowi.activityService.createActivity({
      action: SupportedAction.ACTION_PAGE_BOOKMARK,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: page,
      user: String(actor._id),
      snapshot: { username: actor.username },
    });
    if (activity == null) {
      throw new Error('the bookmark activity was not recorded');
    }
    crowi.events.activity.emit(
      'updated',
      activity,
      page,
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

    await emitBookmark(page);

    expect(await notifiedUsernames(page, 2)).toEqual([
      member.username,
      outsider.username,
    ]);
  });

  it('does not notify a subscriber outside the group of a group-only page', async () => {
    const page = await createSubscribedPage('bookmarked', groupOnly());

    await emitBookmark(page);

    expect(await notifiedUsernames(page, 1)).toEqual([member.username]);
  });

  it('applies the same rule to notifications of a page update', async () => {
    const page = await createSubscribedPage('updated', groupOnly());

    const emitted = await emitPageUpdateActivity(crowi, {
      activityId: new Types.ObjectId().toString(),
      page,
      user: actor,
    });

    expect(emitted).toBe(true);
    expect(await notifiedUsernames(page, 1)).toEqual([member.username]);
  });
});
