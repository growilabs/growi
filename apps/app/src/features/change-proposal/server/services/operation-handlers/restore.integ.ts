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

import { createRestoreHandler } from './restore';
import type {
  AppliedOutcome,
  OperationContext,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const PREFIX = '/cp-restore-handler-integ';
const TEST_IP = '10.0.0.146';
const TEST_ENDPOINT = '/_api/v3/cp-restore-handler-integ';
const REQUESTER_USERNAME = 'cpRestoreHandlerRequester';
const SUBSCRIBER_USERNAME = 'cpRestoreHandlerSubscriber';
const OTHER_USERNAME = 'cpRestoreHandlerOther';

type RestoreOperation = OperationRecordOf<'restore'>;

describe('restore operation handler', () => {
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
          fromPath: new RegExp(`^(/trash)?${PREFIX}/`),
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

  // Trashed by someone else, as the original proposal's trash would have been.
  const createTrashedPage = async (
    grant: PageGrant = PageGrant.GRANT_PUBLIC,
  ): Promise<{
    readonly page: HydratedDocument<PageDocument>;
    readonly originalPath: string;
  }> => {
    const created = await createPage(nextPath(), grant);
    await crowi.pageService.deletePage(created, other, {}, false, {
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
    });
    return { page: await findPage(created._id), originalPath: created.path };
  };

  const restoreOp = (
    page: HydratedDocument<PageDocument>,
    toPath: string,
  ): RestoreOperation => {
    if (page.revision == null) {
      throw new Error(`page ${page._id} has no revision`);
    }
    return {
      type: 'restore',
      index: 0,
      key: 'op-restore',
      status: 'pending',
      pageId: page._id.toString(),
      expectedRevisionId: getIdStringForRef(page.revision),
      toPath,
    };
  };

  const contextFor = (
    op: RestoreOperation,
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
        ([event, , , target]) =>
          event === 'update' &&
          target instanceof Object &&
          '_id' in target &&
          String(target._id) === pageId.toString(),
      ).length;
  };

  const countRevertNotifications = (pageId: mongoose.Types.ObjectId) =>
    InAppNotification.countDocuments({
      user: subscriber._id,
      target: pageId,
      action: SupportedAction.ACTION_PAGE_REVERT,
    }).exec();

  const findRevertActivity = (pageId: mongoose.Types.ObjectId) =>
    prisma.activities.findFirst({
      where: {
        ip: TEST_IP,
        target: pageId.toString(),
        action: SupportedAction.ACTION_PAGE_REVERT,
      },
    });

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
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: PREFIX } },
    });
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
    it('restores the page to its original path as the requester, removes the redirect trashing left there, and emits the revert event', async () => {
      const handler = createRestoreHandler(crowi);
      const { page, originalPath } = await createTrashedPage();
      expect(
        (await prisma.pageredirects.retrievePageRedirectEndpoints(originalPath))
          ?.end.toPath,
      ).toBe(page.path);
      const op = restoreOp(page, originalPath);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'applied',
        resultPageId: page._id.toString(),
        resultRevisionId: null,
      });
      const restored = await findPage(page._id);
      expect(restored.path).toBe(originalPath);
      expect(restored.status).toBe(Page.STATUS_PUBLISHED);
      expect(restored.lastUpdateUser?.toString()).toBe(
        requester._id.toString(),
      );
      expect(
        await prisma.pageredirects.retrievePageRedirectEndpoints(originalPath),
      ).toBeNull();
      expect(await Page.findByPath(originalPath)).toMatchObject({
        _id: page._id,
      });
      expect(pageEventEmit).toHaveBeenCalledWith(
        'revert',
        expect.objectContaining({ path: page.path }),
        expect.objectContaining({ path: originalPath }),
        expect.anything(),
      );
    });

    it('fails with original-path-occupied and writes nothing when a non-empty page now sits at the original path', async () => {
      const handler = createRestoreHandler(crowi);
      const { page, originalPath } = await createTrashedPage();
      const occupant = await createPage(originalPath);
      const op = restoreOp(page, originalPath);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'original-path-occupied',
      });
      expect((await findPage(page._id)).path).toBe(page.path);
      expect((await findPage(occupant._id)).path).toBe(originalPath);
    });

    it('fails with not-in-trash when the page is no longer in the trash', async () => {
      const handler = createRestoreHandler(crowi);
      const page = await createPage(nextPath());
      const op = restoreOp(page, page.path);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({ status: 'failed', reason: 'not-in-trash' });
    });

    it('fails with edited-after-apply when the latest revision is not the expected one', async () => {
      const handler = createRestoreHandler(crowi);
      const { page, originalPath } = await createTrashedPage();
      const op: RestoreOperation = {
        ...restoreOp(page, originalPath),
        expectedRevisionId: new mongoose.Types.ObjectId().toString(),
      };

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'edited-after-apply',
      });
      expect((await findPage(page._id)).path).toBe(page.path);
    });

    it('fails with target-unavailable when the requester cannot view the page', async () => {
      const handler = createRestoreHandler(crowi);
      const { page, originalPath } = await createTrashedPage(
        PageGrant.GRANT_OWNER,
      );
      const op = restoreOp(page, originalPath);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'target-unavailable',
      });
      expect((await findPage(page._id)).path).toBe(page.path);
    });
  });

  describe('with a Japanese path', () => {
    it('restores a page trashed from a Japanese path and removes only the redirect trashing left there', async () => {
      const handler = createRestoreHandler(crowi);
      seq += 1;
      const originalPath = `${PREFIX}/日本語-${seq}/ページ　全角空白（かっこ）a.b[1]`;
      const created = await createPage(originalPath);
      await crowi.pageService.deletePage(created, other, {}, false, {
        ip: TEST_IP,
        endpoint: TEST_ENDPOINT,
      });
      const page = await findPage(created._id);
      expect(page.path).toBe(`/trash${originalPath}`);
      const lookAlike = originalPath.replace('.', 'X');
      await prisma.pageredirects.create({
        data: { fromPath: lookAlike, toPath: page.path },
      });
      const op = restoreOp(page, originalPath);

      expectApplied(await handler.execute(op, contextFor(op, false)));

      expect((await findPage(page._id)).path).toBe(originalPath);
      expect(
        await prisma.pageredirects.retrievePageRedirectEndpoints(originalPath),
      ).toBeNull();
      expect(
        await prisma.pageredirects.retrievePageRedirectEndpoints(lookAlike),
      ).not.toBeNull();
    });
  });

  describe('findExistingResult', () => {
    it('finds nothing while the page is in the trash and the applied result once it is back at the original path', async () => {
      const handler = createRestoreHandler(crowi);
      const { page, originalPath } = await createTrashedPage();
      const op = restoreOp(page, originalPath);
      const ctx = contextFor(op, false);

      expect(await handler.findExistingResult(op, ctx)).toBeNull();
      const applied = await handler.execute(op, ctx);

      expect(await handler.findExistingResult(op, ctx)).toEqual(applied);
    });

    it('finishes the redirect removal of a restore that stopped right after restoring the page', async () => {
      const handler = createRestoreHandler(crowi);
      const { page, originalPath } = await createTrashedPage();
      const op = restoreOp(page, originalPath);
      await crowi.pageService.revertDeletedPage(page, requester, {}, false, {
        ip: TEST_IP,
        endpoint: TEST_ENDPOINT,
      });

      const outcome = await handler.findExistingResult(
        op,
        contextFor(op, false),
      );

      expect(outcome).toEqual({
        status: 'applied',
        resultPageId: page._id.toString(),
        resultRevisionId: null,
      });
      expect(
        await prisma.pageredirects.retrievePageRedirectEndpoints(originalPath),
      ).toBeNull();
    });
  });

  describe('per-page notifications', () => {
    it('notifies subscribers in-app when perPageNotifications is true and sends no global notification', async () => {
      const spies = installNotificationSpies();
      const handler = createRestoreHandler(crowi);
      const { page, originalPath } = await createTrashedPage();
      await subscribe(page);
      const notifyingEmits = spyNotifyingEmits(page._id);
      const op = restoreOp(page, originalPath);
      const ctx = contextFor(op, true);

      const outcome = expectApplied(await handler.execute(op, ctx));
      await handler.sendPerPageNotifications(op, outcome, ctx);

      await vi.waitFor(
        async () => {
          expect(await countRevertNotifications(page._id)).toBe(1);
        },
        { timeout: 5000, interval: 50 },
      );
      expect((await findRevertActivity(page._id))?.userId).toBe(
        requester._id.toString(),
      );
      expect(notifyingEmits()).toBe(1);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
      expect(spies.userFire).not.toHaveBeenCalled();
    });

    it('sends no in-app notification when perPageNotifications is false, and still records the revert activity', async () => {
      const spies = installNotificationSpies();
      const handler = createRestoreHandler(crowi);
      const { page, originalPath } = await createTrashedPage();
      await subscribe(page);
      const notifyingEmits = spyNotifyingEmits(page._id);
      const op = restoreOp(page, originalPath);

      expectApplied(await handler.execute(op, contextFor(op, false)));

      await vi.waitFor(
        async () => {
          expect((await findRevertActivity(page._id))?.userId).toBe(
            requester._id.toString(),
          );
        },
        { timeout: 5000, interval: 50 },
      );
      expect(await countRevertNotifications(page._id)).toBe(0);
      expect(notifyingEmits()).toBe(0);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
    });
  });
});
