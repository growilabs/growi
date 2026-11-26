import { type IUserHasId, PageGrant } from '@growi/core';
import mongoose, { type HydratedDocument } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import { InAppNotificationStatuses } from '~/interfaces/in-app-notification';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PREFIX = `/in-app-notification-list-target-integ-${WORKER_ID}`;

describe('listing in-app notifications', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let owner: HydratedDocument<IUserHasId>;
  let recipient: HydratedDocument<IUserHasId>;

  const createUser = (role: string) => {
    const username = `ianlt-${role}-${WORKER_ID}`;
    return mongoose.model<IUserHasId>('User').create({
      name: username,
      username,
      email: `${username}@example.com`,
      status: 2,
    });
  };

  // Stands for a notification delivered while the recipient could view the page.
  const notifyRecipientAbout = (page: HydratedDocument<PageDocument>) =>
    InAppNotification.create({
      user: recipient._id,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      target: page._id,
      action: SupportedAction.ACTION_PAGE_BOOKMARK,
      status: InAppNotificationStatuses.STATUS_UNOPENED,
      snapshot: JSON.stringify({ path: page.path, creator: owner._id }),
      activities: [],
    });

  const listForRecipient = async () => {
    const service = crowi.inAppNotificationService;
    if (service == null) {
      throw new Error('inAppNotificationService is not initialized');
    }
    const result = await service.getLatestNotificationsByUser(recipient, {
      offset: 0,
      limit: 10,
    });
    return result.docs.map((doc) => doc.toObject());
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    owner = await createUser('owner');
    recipient = await createUser('recipient');
  });

  afterEach(async () => {
    await InAppNotification.deleteMany({ user: recipient._id });
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}/`) });
  });

  afterAll(async () => {
    await mongoose
      .model('User')
      .deleteMany({ _id: { $in: [owner._id, recipient._id] } });
  });

  it('returns the current page as the target of a page the recipient can view', async () => {
    const page = await Page.create({
      path: `${PREFIX}/public`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: owner._id,
      lastUpdateUser: owner._id,
    });
    await notifyRecipientAbout(page);

    const [notification] = await listForRecipient();

    expect(notification.target).toMatchObject({ path: page.path });
  });

  it('does not reveal the current state of a page the recipient can no longer view', async () => {
    const page = await Page.create({
      path: `${PREFIX}/before-rename`,
      grant: PageGrant.GRANT_PUBLIC,
      creator: owner._id,
      lastUpdateUser: owner._id,
    });
    await notifyRecipientAbout(page);
    const renamedPath = `${PREFIX}/renamed-owner-only`;
    await Page.updateOne(
      { _id: page._id },
      {
        path: renamedPath,
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [owner._id],
      },
    );

    const notifications = await listForRecipient();

    // still listed, rendered from the snapshot taken at delivery
    expect(notifications).toHaveLength(1);
    expect(JSON.stringify(notifications)).not.toContain(renamedPath);
  });
});
