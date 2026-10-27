import type { IUserHasId } from '@growi/core';
import {
  getIdStringForRef,
  PageGrant,
  SubscriptionStatusType,
} from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import Subscription from '~/server/models/subscription';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { GlobalNotificationService } from '~/server/service/global-notification';
import type { UserNotificationService } from '~/server/service/user-notification';
import { prisma } from '~/utils/prisma';

import { createTrashHandler } from './trash';
import type {
  AppliedOutcome,
  OperationContext,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const PREFIX = '/cp-trash-handler-integ';
const TEST_IP = '10.0.0.145';
const TEST_ENDPOINT = '/_api/v3/cp-trash-handler-integ';
const REQUESTER_USERNAME = 'cpTrashHandlerRequester';
const SUBSCRIBER_USERNAME = 'cpTrashHandlerSubscriber';
const OTHER_USERNAME = 'cpTrashHandlerOther';

type TrashOperation = OperationRecordOf<'trash'>;

describe('trash operation handler', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let requester: HydratedDocument<IUserHasId>;
  let subscriber: HydratedDocument<IUserHasId>;
  let other: HydratedDocument<IUserHasId>;
  let seq = 0;
  let restoreServices: () => void = () => {};

  const waitForPageOperationsToFinish = async (): Promise<void> => {
    await vi.waitFor(
      async () => {
        const remaining = await PageOperation.countDocuments({
          fromPath: new RegExp(`^${PREFIX}/`),
        });
        expect(remaining).toBe(0);
      },
      { timeout: 5000, interval: 50 },
    );
  };

  const nextPath = (): string => {
    seq += 1;
    return `${PREFIX}/page-${seq}`;
  };

  const findPage = async (
    pageId: mongoose.Types.ObjectId | string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.findById(pageId);
    if (page == null) {
      throw new Error(`page ${pageId} not found`);
    }
    return page;
  };

  const createPage = async (
    path: string,
    grant: PageGrant = PageGrant.GRANT_PUBLIC,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await crowi.pageService.create(path, 'body', other, {
      grant,
    });
    await waitForPageOperationsToFinish();
    return findPage(page._id);
  };

  const trashOp = (page: HydratedDocument<PageDocument>): TrashOperation => {
    if (page.revision == null) {
      throw new Error(`page ${page._id} has no revision`);
    }
    return {
      type: 'trash',
      index: 0,
      key: 'op-trash',
      status: 'pending',
      pageId: page._id.toString(),
      expectedRevisionId: getIdStringForRef(page.revision),
    };
  };

  const contextFor = (
    op: TrashOperation,
    perPageNotifications: boolean,
  ): OperationContext => ({
    proposalId: new mongoose.Types.ObjectId().toString(),
    operationKey: op.key,
    requester,
    activityParameters: { ip: TEST_IP, endpoint: TEST_ENDPOINT },
    perPageNotifications,
  });

  const expectApplied = (outcome: OperationOutcome): AppliedOutcome => {
    if (outcome.status !== 'applied') {
      throw new Error(`expected applied, got ${JSON.stringify(outcome)}`);
    }
    return outcome;
  };

  const subscribe = (page: HydratedDocument<PageDocument>) =>
    Subscription.subscribeByPageId(
      new mongoose.Types.ObjectId(subscriber._id),
      page._id,
      SubscriptionStatusType.SUBSCRIBE,
    );

  // The listener creates in-app notifications later, so a count read right after
  // execute cannot prove suppression; the emit that triggers them is synchronous.
  const spyNotifyingEmits = (pageId: mongoose.Types.ObjectId) => {
    const emit = vi.spyOn(crowi.events.activity, 'emit');
    return (): number =>
      emit.mock.calls.filter(
        ([event, , target]) =>
          event === 'updated' &&
          target instanceof Object &&
          '_id' in target &&
          String(target._id) === pageId.toString(),
      ).length;
  };

  const countDeleteNotifications = (pageId: mongoose.Types.ObjectId) =>
    InAppNotification.countDocuments({
      user: subscriber._id,
      target: pageId,
      action: SupportedAction.ACTION_PAGE_DELETE,
    }).exec();

  // The integration Crowi has no notification services; a real global one is
  // installed so its grant check runs, with only the mail/Slack senders stubbed.
  const installNotificationSpies = () => {
    const originals = {
      global: crowi.globalNotificationService,
      user: crowi.userNotificationService,
    };
    restoreServices = () => {
      crowi.globalNotificationService = originals.global;
      crowi.userNotificationService = originals.user;
    };
    const globalNotificationService = new GlobalNotificationService(crowi);
    const mailFire = vi
      .spyOn(globalNotificationService.globalNotificationMailService, 'fire')
      .mockResolvedValue();
    const slackFire = vi
      .spyOn(globalNotificationService.globalNotificationSlackService, 'fire')
      .mockResolvedValue();
    const userNotificationService = mock<UserNotificationService>();
    crowi.globalNotificationService = globalNotificationService;
    crowi.userNotificationService = userNotificationService;
    return { mailFire, slackFire, userFire: userNotificationService.fire };
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    PageOperation = mongoose.model<IPageOperation, PageOperationModel>(
      'PageOperation',
    );

    await configManager.updateConfigs({
      'app:isV5Compatible': true,
      'app:auditLogEnabled': true,
    });

    const existingRoot = await Page.findOne({ path: '/' });
    if (existingRoot == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }

    const User = mongoose.model<IUserHasId>('User');
    const createUser = (username: string) =>
      User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        status: UserStatus.STATUS_ACTIVE,
      });
    requester = await createUser(REQUESTER_USERNAME);
    subscriber = await createUser(SUBSCRIBER_USERNAME);
    other = await createUser(OTHER_USERNAME);
  });

  let pageEventEmit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    pageEventEmit = vi
      .spyOn(crowi.pageService.pageEvent, 'emit')
      .mockReturnValue(true);
  });

  afterEach(async () => {
    await waitForPageOperationsToFinish();
    restoreServices();
    restoreServices = () => {};
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const pages = await Page.find({
      path: new RegExp(`^(/trash)?${PREFIX}(/|$)`),
    });
    const pageIds = pages.map((p) => p._id);
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pageIds.map((id) => id.toString()) } },
    });
    await prisma.pageredirects.deleteRedirectsFromPathTree(PREFIX);
    await InAppNotification.deleteMany({ target: { $in: pageIds } });
    await Subscription.deleteMany({ target: { $in: pageIds } });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await mongoose.model('User').deleteMany({
      username: {
        $in: [REQUESTER_USERNAME, SUBSCRIBER_USERNAME, OTHER_USERNAME],
      },
    });
    await configManager.updateConfigs(
      { 'app:isV5Compatible': undefined, 'app:auditLogEnabled': undefined },
      { removeIfUndefined: true },
    );
  });

  describe('execute', () => {
    it('moves the page to the trash as the requester, records the delete activity and emits the delete event', async () => {
      const handler = createTrashHandler(crowi);
      const page = await createPage(nextPath());
      const op = trashOp(page);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'applied',
        resultPageId: page._id.toString(),
        resultRevisionId: null,
      });
      const trashed = await findPage(page._id);
      expect(trashed.path).toBe(`/trash${page.path}`);
      expect(trashed.status).toBe(Page.STATUS_DELETED);
      expect(trashed.deleteUser?.toString()).toBe(requester._id.toString());
      const activity = await prisma.activities.findFirst({
        where: {
          ip: TEST_IP,
          target: page._id.toString(),
          action: SupportedAction.ACTION_PAGE_DELETE,
        },
      });
      expect(activity?.userId).toBe(requester._id.toString());
      expect(pageEventEmit).toHaveBeenCalledWith(
        'delete',
        expect.objectContaining({ path: page.path }),
        expect.objectContaining({ path: trashed.path }),
        expect.anything(),
      );
    });

    it('fails with edited-after-apply and leaves the page in place when the latest revision is not the expected one', async () => {
      const handler = createTrashHandler(crowi);
      const page = await createPage(nextPath());
      const op = trashOp(page);
      await crowi.pageService.updatePage(page, 'edited', null, other, {});
      await waitForPageOperationsToFinish();

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'edited-after-apply',
      });
      expect((await findPage(page._id)).path).toBe(page.path);
    });

    it('fails with has-children and leaves the page in place when it has a child page', async () => {
      const handler = createTrashHandler(crowi);
      const page = await createPage(nextPath());
      await createPage(`${page.path}/child`);
      const op = trashOp(page);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({ status: 'failed', reason: 'has-children' });
      expect((await findPage(page._id)).path).toBe(page.path);
    });

    it('fails with target-unavailable when the requester cannot view the page', async () => {
      const handler = createTrashHandler(crowi);
      const page = await createPage(nextPath(), PageGrant.GRANT_OWNER);
      const op = trashOp(page);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'target-unavailable',
      });
      expect((await findPage(page._id)).path).toBe(page.path);
    });

    describe("under the admin's page deletion authority", () => {
      afterEach(async () => {
        await configManager.updateConfigs(
          { 'security:pageDeletionAuthority': undefined },
          { removeIfUndefined: true },
        );
      });

      it('fails with not-deletable and leaves the page in place when only admins may delete', async () => {
        await configManager.updateConfigs({
          'security:pageDeletionAuthority': 'adminOnly',
        });
        const handler = createTrashHandler(crowi);
        const page = await createPage(nextPath());
        const op = trashOp(page);

        const outcome = await handler.execute(op, contextFor(op, false));

        expect(outcome).toEqual({ status: 'failed', reason: 'not-deletable' });
        expect((await findPage(page._id)).path).toBe(page.path);
      });

      it("fails with not-deletable for someone else's page and trashes the requester's own when admins and authors may delete", async () => {
        await configManager.updateConfigs({
          'security:pageDeletionAuthority': 'adminAndAuthor',
        });
        const handler = createTrashHandler(crowi);
        const othersPage = await createPage(nextPath());
        const created = await crowi.pageService.create(
          nextPath(),
          'body',
          requester,
          {},
        );
        await waitForPageOperationsToFinish();
        const ownPage = await findPage(created._id);
        const othersOp = trashOp(othersPage);
        const ownOp = trashOp(ownPage);

        await expect(
          handler.execute(othersOp, contextFor(othersOp, false)),
        ).resolves.toEqual({ status: 'failed', reason: 'not-deletable' });
        expectApplied(await handler.execute(ownOp, contextFor(ownOp, false)));
        expect((await findPage(othersPage._id)).path).toBe(othersPage.path);
        expect((await findPage(ownPage._id)).path).toBe(
          `/trash${ownPage.path}`,
        );
      });
    });
  });

  describe('with a Japanese path', () => {
    const japanesePath = (): string => {
      seq += 1;
      return `${PREFIX}/日本語-${seq}/ページ　全角空白（かっこ）a.b[1]`;
    };

    it('moves the page to the trash under its Japanese path and notifies with the path it had before trashing', async () => {
      const spies = installNotificationSpies();
      const handler = createTrashHandler(crowi);
      const page = await createPage(japanesePath());
      const op = trashOp(page);
      const ctx = contextFor(op, true);

      const outcome = expectApplied(await handler.execute(op, ctx));
      expect(await handler.findExistingResult(op, ctx)).toEqual(outcome);
      await handler.sendPerPageNotifications(op, outcome, ctx);

      expect((await findPage(page._id)).path).toBe(`/trash${page.path}`);
      expect(spies.slackFire).toHaveBeenCalledWith(
        GlobalNotificationSettingEvent.PAGE_DELETE,
        page._id.toString(),
        page.path,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('findExistingResult', () => {
    it('finds nothing before trashing and the applied result once the page is in the trash', async () => {
      const handler = createTrashHandler(crowi);
      const page = await createPage(nextPath());
      const op = trashOp(page);
      const ctx = contextFor(op, false);

      expect(await handler.findExistingResult(op, ctx)).toBeNull();
      const applied = await handler.execute(op, ctx);

      expect(await handler.findExistingResult(op, ctx)).toEqual(applied);
    });
  });

  describe('per-page notifications', () => {
    it('sends no global notification from the page service itself, but notifies subscribers in-app when perPageNotifications is true', async () => {
      const spies = installNotificationSpies();
      const handler = createTrashHandler(crowi);
      const page = await createPage(nextPath());
      await subscribe(page);
      const notifyingEmits = spyNotifyingEmits(page._id);
      const op = trashOp(page);

      expectApplied(await handler.execute(op, contextFor(op, true)));

      await vi.waitFor(
        async () => {
          expect(await countDeleteNotifications(page._id)).toBe(1);
        },
        { timeout: 5000, interval: 50 },
      );
      expect(notifyingEmits()).toBe(1);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
      expect(spies.userFire).not.toHaveBeenCalled();
    });

    it('sends no in-app notification when perPageNotifications is false, and still records the delete activity', async () => {
      const spies = installNotificationSpies();
      const handler = createTrashHandler(crowi);
      const page = await createPage(nextPath());
      await subscribe(page);
      const notifyingEmits = spyNotifyingEmits(page._id);
      const op = trashOp(page);

      expectApplied(await handler.execute(op, contextFor(op, false)));

      expect(await countDeleteNotifications(page._id)).toBe(0);
      expect(
        await prisma.activities.count({
          where: {
            ip: TEST_IP,
            target: page._id.toString(),
            action: SupportedAction.ACTION_PAGE_DELETE,
          },
        }),
      ).toBe(1);
      expect(notifyingEmits()).toBe(0);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
    });

    it('sends the delete global notification for the path the page had before trashing, as the delete route does', async () => {
      const spies = installNotificationSpies();
      const handler = createTrashHandler(crowi);
      const page = await createPage(nextPath());
      const op = trashOp(page);
      const ctx = contextFor(op, true);
      const outcome = expectApplied(await handler.execute(op, ctx));

      await handler.sendPerPageNotifications(op, outcome, ctx);

      expect(spies.mailFire).toHaveBeenCalledTimes(1);
      expect(spies.mailFire).toHaveBeenCalledWith(
        GlobalNotificationSettingEvent.PAGE_DELETE,
        expect.objectContaining({ _id: page._id, path: page.path }),
        expect.objectContaining({ username: REQUESTER_USERNAME }),
        expect.anything(),
      );
      expect(spies.slackFire).toHaveBeenCalledWith(
        GlobalNotificationSettingEvent.PAGE_DELETE,
        page._id.toString(),
        page.path,
        expect.objectContaining({ username: REQUESTER_USERNAME }),
        expect.anything(),
      );
      expect(spies.userFire).not.toHaveBeenCalled();
      expect((await findPage(page._id)).path).toBe(`/trash${page.path}`);
    });

    it('does not throw when the trashed page is gone', async () => {
      const spies = installNotificationSpies();
      const handler = createTrashHandler(crowi);
      const page = await createPage(nextPath());
      const op = trashOp(page);

      await expect(
        handler.sendPerPageNotifications(
          op,
          {
            status: 'applied',
            resultPageId: new mongoose.Types.ObjectId().toString(),
            resultRevisionId: null,
          },
          contextFor(op, true),
        ),
      ).resolves.toBeUndefined();
      expect(spies.mailFire).not.toHaveBeenCalled();
    });
  });
});
