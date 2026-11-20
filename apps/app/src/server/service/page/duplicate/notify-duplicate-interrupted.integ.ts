import type { EventEmitter } from 'node:events';
import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { pageDuplicateInterruptedSnapshot } from '~/models/serializers/in-app-notification-snapshot/page-duplicate-interrupted';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import { prisma } from '~/utils/prisma';

import { notifyDuplicateInterrupted } from './notify-duplicate-interrupted';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PREFIX = `/notify-duplicate-interrupted-integ-${WORKER_ID}`;

describe('notifyDuplicateInterrupted', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let actor: HydratedDocument<IUserHasId>;
  let subscriber: HydratedDocument<IUserHasId>;
  let copyTop: HydratedDocument<PageDocument>;

  // The in-app notification listener is async and emit() does not wait for it.
  const waitForNotifications = async (
    expectedUserId: string,
  ): Promise<void> => {
    for (let i = 0; i < 100; i++) {
      // biome-ignore lint/performance/noAwaitInLoops: polling
      const count = await InAppNotification.countDocuments({
        user: expectedUserId,
        target: copyTop._id,
      });
      if (count > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    const User = mongoose.model<IUserHasId>('User');
    actor = await User.create({
      name: `ndi-actor-${WORKER_ID}`,
      username: `ndiActor${WORKER_ID}`,
      email: `ndi-actor-${WORKER_ID}@example.com`,
      status: 2,
    });
    subscriber = await User.create({
      name: `ndi-sub-${WORKER_ID}`,
      username: `ndiSub${WORKER_ID}`,
      email: `ndi-sub-${WORKER_ID}@example.com`,
      status: 2,
    });
    copyTop = await Page.create({
      path: `${PREFIX}/copy`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: actor._id,
    });
    for (const user of [subscriber, actor]) {
      // biome-ignore lint/performance/noAwaitInLoops: two fixture subscriptions
      await Subscription.subscribeByPageId(
        new mongoose.Types.ObjectId(String(user._id)),
        copyTop._id,
        'SUBSCRIBE',
      );
    }
  });

  afterAll(async () => {
    const userIds = [actor._id, subscriber._id];
    await InAppNotification.deleteMany({ user: { $in: userIds } });
    await Subscription.deleteMany({ user: { $in: userIds } });
    await prisma.activities.deleteMany({
      where: { userId: String(actor._id) },
    });
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}(/|$)`) });
    await mongoose.model('User').deleteMany({ _id: { $in: userIds } });
  });

  it('notifies only the duplicating user, once, with paths and counts (Req 5.1, 5.2, 5.5)', async () => {
    await notifyDuplicateInterrupted(
      {
        activityService: crowi.activityService,
        activityEvent: crowi.events.activity as EventEmitter,
      },
      {
        userId: String(actor._id),
        copyTopPage: copyTop,
        fromPath: `${PREFIX}/from`,
        toPath: copyTop.path,
        copiedPageCount: 3,
        sourcePageCount: 10,
      },
    );
    await waitForNotifications(String(actor._id));
    // give a wrongly addressed notification time to land
    await new Promise((resolve) => setTimeout(resolve, 300));

    const all = await InAppNotification.find({ target: copyTop._id }).lean();
    expect(all).toHaveLength(1);
    expect(String(all[0].user)).toBe(String(actor._id));
    expect(all[0]).toMatchObject({
      targetModel: SupportedTargetModel.MODEL_PAGE,
      action: SupportedAction.ACTION_PAGE_DUPLICATE_INTERRUPTED,
    });
    expect(pageDuplicateInterruptedSnapshot.parse(all[0].snapshot)).toEqual({
      path: copyTop.path,
      fromPath: `${PREFIX}/from`,
      toPath: copyTop.path,
      copiedPageCount: 3,
      sourcePageCount: 10,
    });
  });
});
