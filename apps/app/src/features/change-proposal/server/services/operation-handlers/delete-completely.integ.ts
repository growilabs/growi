import type { IUserHasId } from '@growi/core';
import {
  GroupType,
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

import { createDeleteCompletelyHandler } from './delete-completely';
import type {
  AppliedOutcome,
  OperationContext,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const PREFIX = '/cp-delete-completely-handler-integ';
const TEST_IP = '10.0.0.145';
const TEST_ENDPOINT = '/_api/v3/cp-delete-completely-handler-integ';
const REQUESTER_USERNAME = 'cpDeleteCompletelyRequester';
const SUBSCRIBER_USERNAME = 'cpDeleteCompletelySubscriber';
const OTHER_USERNAME = 'cpDeleteCompletelyOther';
const GROUP_NAMES = ['cpDeleteCompletelyGroupA', 'cpDeleteCompletelyGroupB'];

type DeleteCompletelyOperation = OperationRecordOf<'delete-completely'>;

describe('delete-completely operation handler', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let requester: HydratedDocument<IUserHasId>;
  let subscriber: HydratedDocument<IUserHasId>;
  let other: HydratedDocument<IUserHasId>;
  // `other` is in both groups, the requester only in the first.
  let groupIds: mongoose.Types.ObjectId[] = [];
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

  const pageExists = async (
    pageId: mongoose.Types.ObjectId | string,
  ): Promise<boolean> => (await Page.exists({ _id: pageId })) != null;

  const findPage = async (
    pageId: mongoose.Types.ObjectId | string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.findById(pageId);
    if (page == null) {
      throw new Error(`page ${pageId} not found`);
    }
    return page;
  };

  // The home page of a user who exists.
  const userHomePage = async (): Promise<HydratedDocument<PageDocument>> => {
    const path = `/user/${OTHER_USERNAME}`;
    const existing = await Page.findOne({ path });
    if (existing != null) {
      return existing;
    }
    const created = await crowi.pageService.create(path, 'body', other, {});
    await waitForPageOperationsToFinish();
    return findPage(created._id);
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

  const deleteOp = (
    page: HydratedDocument<PageDocument>,
  ): DeleteCompletelyOperation => {
    if (page.revision == null) {
      throw new Error(`page ${page._id} has no revision`);
    }
    return {
      type: 'delete-completely',
      index: 0,
      key: 'op-delete-completely',
      status: 'pending',
      pageId: page._id.toString(),
      expectedRevisionId: getIdStringForRef(page.revision),
    };
  };

  const contextFor = (
    op: DeleteCompletelyOperation,
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
      action: SupportedAction.ACTION_PAGE_DELETE_COMPLETELY,
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

    const groups = await mongoose
      .model('UserGroup')
      .create(GROUP_NAMES.map((name) => ({ name })));
    groupIds = groups.map((group) => group._id);
    await mongoose.model('UserGroupRelation').create([
      ...groupIds.map((relatedGroup) => ({
        relatedGroup,
        relatedUser: other._id,
      })),
      { relatedGroup: groupIds[0], relatedUser: requester._id },
    ]);
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
      $or: [
        { path: new RegExp(`^(/trash)?${PREFIX}(/|$)`) },
        { path: `/user/${OTHER_USERNAME}` },
      ],
    });
    const pageIds = pages.map((p) => p._id);
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pageIds.map((id) => id.toString()) } },
    });
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: PREFIX } },
    });
    await InAppNotification.deleteMany({ target: { $in: pageIds } });
    await Subscription.deleteMany({ target: { $in: pageIds } });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: { $in: groupIds } });
    await mongoose.model('UserGroup').deleteMany({ _id: { $in: groupIds } });
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
    it('deletes the page completely as the requester, leaving nothing in the trash, records the complete-deletion activity and emits the deleteCompletely event', async () => {
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath());
      const op = deleteOp(page);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'applied',
        resultPageId: page._id.toString(),
        resultRevisionId: null,
      });
      expect(await pageExists(page._id)).toBe(false);
      expect(await Page.exists({ path: `/trash${page.path}` })).toBeNull();
      expect(
        await prisma.revisions.count({
          where: { pageId: page._id.toString() },
        }),
      ).toBe(0);
      const activity = await prisma.activities.findFirst({
        where: {
          ip: TEST_IP,
          target: page._id.toString(),
          action: SupportedAction.ACTION_PAGE_DELETE_COMPLETELY,
        },
      });
      expect(activity?.userId).toBe(requester._id.toString());
      expect(pageEventEmit).toHaveBeenCalledWith(
        'deleteCompletely',
        expect.objectContaining({ path: page.path }),
        expect.anything(),
      );
    });

    it('fails with edited-after-apply and leaves the page in place when the latest revision is not the expected one', async () => {
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath());
      const op = deleteOp(page);
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
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath());
      await createPage(`${page.path}/child`);
      const op = deleteOp(page);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({ status: 'failed', reason: 'has-children' });
      expect((await findPage(page._id)).path).toBe(page.path);
    });

    it('fails with target-unavailable when the requester cannot view the page', async () => {
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath(), PageGrant.GRANT_OWNER);
      const op = deleteOp(page);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'target-unavailable',
      });
      expect((await findPage(page._id)).path).toBe(page.path);
    });

    describe("under the admin's page deletion authorities", () => {
      afterEach(async () => {
        await configManager.updateConfigs(
          {
            'security:pageDeletionAuthority': undefined,
            'security:pageCompleteDeletionAuthority': undefined,
            'security:user-homepage-deletion:isEnabled': undefined,
          },
          { removeIfUndefined: true },
        );
      });

      it.each([
        ['moving to the trash', 'security:pageDeletionAuthority'],
        ['deleting completely', 'security:pageCompleteDeletionAuthority'],
      ] as const)('fails with not-deletable and leaves the page in place when only admins may delete by %s', async (_label, key) => {
        await configManager.updateConfigs({ [key]: 'adminOnly' });
        const handler = createDeleteCompletelyHandler(crowi);
        const page = await createPage(nextPath());
        const op = deleteOp(page);

        const outcome = await handler.execute(op, contextFor(op, false));

        expect(outcome).toEqual({ status: 'failed', reason: 'not-deletable' });
        expect((await findPage(page._id)).path).toBe(page.path);
      });

      it("fails with not-deletable for someone else's page and deletes the requester's own when admins and authors may delete completely", async () => {
        await configManager.updateConfigs({
          'security:pageCompleteDeletionAuthority': 'adminAndAuthor',
        });
        const handler = createDeleteCompletelyHandler(crowi);
        const othersPage = await createPage(nextPath());
        const created = await crowi.pageService.create(
          nextPath(),
          'body',
          requester,
          {},
        );
        await waitForPageOperationsToFinish();
        const ownPage = await findPage(created._id);
        const othersOp = deleteOp(othersPage);
        const ownOp = deleteOp(ownPage);

        await expect(
          handler.execute(othersOp, contextFor(othersOp, false)),
        ).resolves.toEqual({ status: 'failed', reason: 'not-deletable' });
        expectApplied(await handler.execute(ownOp, contextFor(ownOp, false)));
        expect((await findPage(othersPage._id)).path).toBe(othersPage.path);
        expect(await pageExists(ownPage._id)).toBe(false);
      });

      // The all-groups rule applies only while anyone may delete completely.
      it('fails with not-deletable on a page granted to several groups when the requester is in only some of them', async () => {
        await configManager.updateConfigs({
          'security:pageCompleteDeletionAuthority': 'anyOne',
        });
        const handler = createDeleteCompletelyHandler(crowi);
        const created = await crowi.pageService.create(
          nextPath(),
          'body',
          other,
          {
            grant: PageGrant.GRANT_USER_GROUP,
            grantUserGroupIds: groupIds.map((item) => ({
              item,
              type: GroupType.userGroup,
            })),
          },
        );
        await waitForPageOperationsToFinish();
        const page = await findPage(created._id);
        const op = deleteOp(page);

        const outcome = await handler.execute(op, contextFor(op, false));

        expect(outcome).toEqual({ status: 'failed', reason: 'not-deletable' });
        expect(await pageExists(page._id)).toBe(true);
      });

      it.each([
        ['user home deletion is turned off', false],
        ['its owner still exists', true],
      ])('fails with not-deletable on a user home page when %s', async (_label, isEnabled) => {
        await configManager.updateConfigs({
          'security:user-homepage-deletion:isEnabled': isEnabled,
        });
        const handler = createDeleteCompletelyHandler(crowi);
        const page = await userHomePage();
        const op = deleteOp(page);

        const outcome = await handler.execute(op, contextFor(op, false));

        expect(outcome).toEqual({ status: 'failed', reason: 'not-deletable' });
        expect(await pageExists(page._id)).toBe(true);
      });
    });
  });

  describe('with a Japanese path', () => {
    const japanesePath = (): string => {
      seq += 1;
      return `${PREFIX}/日本語-${seq}/ページ　全角空白（かっこ）a.b[1]`;
    };

    it('deletes the page under its Japanese path and notifies with that path', async () => {
      const spies = installNotificationSpies();
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(japanesePath());
      const op = deleteOp(page);
      const ctx = contextFor(op, true);

      const outcome = expectApplied(await handler.execute(op, ctx));
      await handler.sendPerPageNotifications(op, outcome, ctx);

      expect(await pageExists(page._id)).toBe(false);
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
    it('finds nothing before the deletion and the applied result once the page is gone', async () => {
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath());
      const op = deleteOp(page);
      const ctx = contextFor(op, false);

      expect(await handler.findExistingResult(op, ctx)).toBeNull();
      const applied = await handler.execute(op, ctx);

      expect(await handler.findExistingResult(op, ctx)).toEqual(applied);
    });

    it('finds nothing while the page sits in the trash', async () => {
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath());
      const op = deleteOp(page);
      await crowi.pageService.deletePage(page, other, {}, false, {});
      await waitForPageOperationsToFinish();

      expect(
        await handler.findExistingResult(op, contextFor(op, false)),
      ).toBeNull();
    });
  });

  describe('per-page notifications', () => {
    it('notifies subscribers in-app, and sends no global notification from the page service itself, when perPageNotifications is true', async () => {
      const spies = installNotificationSpies();
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath());
      await subscribe(page);
      const notifyingEmits = spyNotifyingEmits(page._id);
      const op = deleteOp(page);

      expectApplied(await handler.execute(op, contextFor(op, true)));

      expect(notifyingEmits()).toBe(1);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
      expect(spies.userFire).not.toHaveBeenCalled();
    });

    it('sends no in-app notification when perPageNotifications is false, and still records the complete-deletion activity', async () => {
      const spies = installNotificationSpies();
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath());
      await subscribe(page);
      const notifyingEmits = spyNotifyingEmits(page._id);
      const op = deleteOp(page);

      expectApplied(await handler.execute(op, contextFor(op, false)));

      expect(notifyingEmits()).toBe(0);
      expect(await countDeleteNotifications(page._id)).toBe(0);
      expect(
        await prisma.activities.count({
          where: {
            ip: TEST_IP,
            target: page._id.toString(),
            action: SupportedAction.ACTION_PAGE_DELETE_COMPLETELY,
          },
        }),
      ).toBe(1);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
    });

    it('sends the delete global notification with the page as it was before the deletion, as the delete route does', async () => {
      const spies = installNotificationSpies();
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath());
      const op = deleteOp(page);
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
    });

    it('sends nothing and does not throw for an operation this handler did not delete', async () => {
      const spies = installNotificationSpies();
      const handler = createDeleteCompletelyHandler(crowi);
      const page = await createPage(nextPath());
      const op = deleteOp(page);

      await expect(
        handler.sendPerPageNotifications(
          op,
          {
            status: 'applied',
            resultPageId: page._id.toString(),
            resultRevisionId: null,
          },
          contextFor(op, true),
        ),
      ).resolves.toBeUndefined();
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
    });
  });
});
