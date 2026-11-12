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
import { pendingActivityContext } from '~/server/service/activity/index';
import { configManager } from '~/server/service/config-manager';
import { GlobalNotificationService } from '~/server/service/global-notification';
import { __resetCacheForTesting as resetNormalizeCache } from '~/server/service/revision/normalize-latest-revision-if-broken';
import type { UserNotificationService } from '~/server/service/user-notification';
import { prisma } from '~/utils/prisma';

import type { OperationRecord } from '../../../interfaces';
import { createEditHandler } from './edit';
import type {
  AppliedOutcome,
  OperationContext,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const PREFIX = '/cp-edit-handler-integ';
const TEST_IP = '10.0.0.142';
const TEST_ENDPOINT = '/_api/v3/cp-edit-handler-integ';
const REQUESTER_USERNAME = 'cpEditHandlerRequester';
const SUBSCRIBER_USERNAME = 'cpEditHandlerSubscriber';
const OTHER_USERNAME = 'cpEditHandlerOther';
const BROKEN_MIGRATION_FILE_NAME =
  '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549';

describe('edit operation handler', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let requester: HydratedDocument<IUserHasId>;
  let subscriber: HydratedDocument<IUserHasId>;
  let other: HydratedDocument<IUserHasId>;
  let pageSeq = 0;
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

  const findPage = async (
    pageId: mongoose.Types.ObjectId | string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.findById(pageId);
    if (page == null) {
      throw new Error(`page ${pageId} not found`);
    }
    return page;
  };

  const currentRevisionIdOf = async (
    pageId: mongoose.Types.ObjectId | string,
  ): Promise<string> => {
    const page = await findPage(pageId);
    if (page.revision == null) {
      throw new Error(`page ${pageId} has no revision`);
    }
    return getIdStringForRef(page.revision);
  };

  const createPage = async (
    owner: IUserHasId,
    grant: PageGrant = PageGrant.GRANT_PUBLIC,
  ): Promise<HydratedDocument<PageDocument>> => {
    pageSeq += 1;
    const page = await crowi.pageService.create(
      `${PREFIX}/page-${pageSeq}`,
      'base body',
      owner,
      { grant },
    );
    await waitForPageOperationsToFinish();
    return findPage(page._id);
  };

  const subscribe = (page: HydratedDocument<PageDocument>) =>
    Subscription.subscribeByPageId(
      new mongoose.Types.ObjectId(subscriber._id),
      page._id,
      SubscriptionStatusType.SUBSCRIBE,
    );

  const humanEdit = async (
    pageId: mongoose.Types.ObjectId | string,
    body: string,
  ): Promise<void> => {
    await crowi.pageService.updatePage(
      await findPage(pageId),
      body,
      null,
      other,
      {},
    );
    await waitForPageOperationsToFinish();
  };

  const editOp = async (
    page: HydratedDocument<PageDocument>,
    key = 'op-edit',
  ): Promise<OperationRecordOf<'edit'>> => ({
    type: 'edit',
    index: 0,
    key,
    status: 'pending',
    pageId: page._id.toString(),
    baseRevisionId: await currentRevisionIdOf(page._id),
    body: 'proposed body',
  });

  const contextFor = (
    op: OperationRecord,
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

  const countUpdateNotifications = (pageId: mongoose.Types.ObjectId) =>
    InAppNotification.countDocuments({
      user: subscriber._id,
      target: pageId,
      action: SupportedAction.ACTION_PAGE_UPDATE,
    }).exec();

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
    const pages = await Page.find({ path: new RegExp(`^${PREFIX}/`) });
    const pageIds = pages.map((p) => p._id);
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pageIds.map((id) => id.toString()) } },
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
    it('writes the body as a new revision authored by the requester, marked and without origin, and emits the page update event', async () => {
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      const ctx = contextFor(op, false);

      const outcome = expectApplied(await handler.execute(op, ctx));

      const latestRevisionId = await currentRevisionIdOf(page._id);
      expect(outcome).toEqual({
        status: 'applied',
        resultPageId: page._id.toString(),
        resultRevisionId: latestRevisionId,
        appliedPagePath: page.path,
      });
      const revision = await prisma.revisions.findUniqueOrThrow({
        where: { id: latestRevisionId },
      });
      expect(revision.body).toBe('proposed body');
      expect(revision.authorId).toBe(requester._id.toString());
      expect(revision.origin).toBeNull();
      expect(revision.proposalId).toBe(ctx.proposalId);
      expect(revision.proposalOperationKey).toBe(op.key);
      const updatedPage = await findPage(page._id);
      expect(updatedPage.lastUpdateUser?.toString()).toBe(
        requester._id.toString(),
      );
      expect(updatedPage.grant).toBe(PageGrant.GRANT_PUBLIC);
      const rawPage = await Page.collection.findOne({ _id: page._id });
      expect(rawPage).not.toHaveProperty('proposalId');
      expect(rawPage).not.toHaveProperty('proposalOperationKey');
      expect(crowi.events.page).toBe(crowi.pageService.pageEvent);
      expect(pageEventEmit).toHaveBeenCalledWith(
        'update',
        expect.objectContaining({ _id: page._id }),
        expect.anything(),
      );
    });

    it('returns stale and leaves the page and no marked revision behind when the page moved past the base revision', async () => {
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      await humanEdit(page._id, 'competitor body');
      const competitorRevisionId = await currentRevisionIdOf(page._id);
      const ctx = contextFor(op, false);

      const outcome = await handler.execute(op, ctx);

      expect(outcome).toEqual({
        status: 'stale',
        reason: 'base-revision-changed',
      });
      expect(await currentRevisionIdOf(page._id)).toBe(competitorRevisionId);
      expect(
        await prisma.revisions.count({
          where: { proposalId: ctx.proposalId },
        }),
      ).toBe(0);
    });

    it('repairs a base revision broken by the v6.1-v7.0 migration before writing on top of it', async () => {
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      // The broken migration left the page's revision pointing at another pageId.
      await prisma.revisions.update({
        where: { id: op.baseRevisionId },
        data: { pageId: new mongoose.Types.ObjectId().toString() },
      });
      const migrations = mongoose.connection.collection('migrations');
      await migrations.insertOne({
        fileName: BROKEN_MIGRATION_FILE_NAME,
        appliedAt: new Date('2024-01-01'),
      });
      resetNormalizeCache();
      try {
        expectApplied(await handler.execute(op, contextFor(op, false)));

        const base = await prisma.revisions.findUniqueOrThrow({
          where: { id: op.baseRevisionId },
        });
        expect(base.pageId).toBe(page._id.toString());
      } finally {
        await migrations.deleteOne({ fileName: BROKEN_MIGRATION_FILE_NAME });
        resetNormalizeCache();
      }
    });

    it('fails with target-unavailable when the requester cannot view the page', async () => {
      const handler = createEditHandler(crowi);
      const page = await createPage(other, PageGrant.GRANT_OWNER);
      const op = await editOp(page);
      const ctx = contextFor(op, false);

      const outcome = await handler.execute(op, ctx);

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'target-unavailable',
      });
      expect(
        await prisma.revisions.count({ where: { proposalId: ctx.proposalId } }),
      ).toBe(0);
    });
  });

  describe('with a Japanese body', () => {
    const JAPANESE_BODY =
      '# 日本語の本文\r\n\r\n絵文字😀👨‍👩‍👧と全角空白　、結合文字がを含む行\r\n';

    it('stores the body and its length the same way a human save of the same text does', async () => {
      const handler = createEditHandler(crowi);
      const proposed = await createPage(other);
      const humanSaved = await createPage(other);
      const op = { ...(await editOp(proposed)), body: JAPANESE_BODY };

      const outcome = expectApplied(
        await handler.execute(op, contextFor(op, false)),
      );
      await humanEdit(humanSaved._id, JAPANESE_BODY);

      const proposedRevision = await prisma.revisions.findUniqueOrThrow({
        where: { id: outcome.resultRevisionId ?? '' },
      });
      const humanRevision = await prisma.revisions.findUniqueOrThrow({
        where: { id: await currentRevisionIdOf(humanSaved._id) },
      });
      // Revision bodies are read back with CR/CRLF turned into LF for every save.
      expect(proposedRevision.body).toBe(JAPANESE_BODY.replace(/\r\n/g, '\n'));
      expect(proposedRevision.body).toBe(humanRevision.body);
      const [proposedPage, humanPage] = await Promise.all([
        findPage(proposed._id),
        findPage(humanSaved._id),
      ]);
      expect(proposedPage.latestRevisionBodyLength).toBe(
        humanPage.latestRevisionBodyLength,
      );
      expect(proposedPage.latestRevisionBodyLength).toBeGreaterThan(0);
    });
  });

  describe('findExistingResult', () => {
    it('finds nothing before the write and the same applied result after it, so a re-run does not write twice', async () => {
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      const ctx = contextFor(op, false);

      expect(await handler.findExistingResult(op, ctx)).toBeNull();
      const applied = await handler.execute(op, ctx);

      const existing = await handler.findExistingResult(op, ctx);
      expect(existing).toEqual(applied);
      expect(existing).toMatchObject({ appliedPagePath: page.path });
      expect(
        await prisma.revisions.count({
          where: { proposalId: ctx.proposalId, proposalOperationKey: op.key },
        }),
      ).toBe(1);
    });

    it('still reports the applied result after a person edited the page on top of it', async () => {
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      const ctx = contextFor(op, false);
      const applied = await handler.execute(op, ctx);

      await humanEdit(page._id, 'edited after apply');

      expect(await handler.findExistingResult(op, ctx)).toEqual(applied);
    });

    it('does not count a left-over marked revision the page never adopted as applied', async () => {
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      const ctx = contextFor(op, false);
      // A lost conditional write whose cleanup failed: someone else moved the
      // page on first, then the marked revision was created but never adopted.
      await humanEdit(page._id, 'competitor body');
      await prisma.revisions.create({
        data: {
          pageId: page._id.toString(),
          body: 'proposed body',
          authorId: requester._id.toString(),
          proposalId: ctx.proposalId,
          proposalOperationKey: op.key,
        },
      });

      expect(await handler.findExistingResult(op, ctx)).toBeNull();
      expect(await handler.execute(op, ctx)).toEqual({
        status: 'stale',
        reason: 'base-revision-changed',
      });
    });

    it('does not count a marked revision as applied while the page is still at the base revision', async () => {
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      const ctx = contextFor(op, false);
      // A run stopped between creating the revision and moving the page to it.
      await prisma.revisions.create({
        data: {
          pageId: page._id.toString(),
          body: 'proposed body',
          authorId: requester._id.toString(),
          proposalId: ctx.proposalId,
          proposalOperationKey: op.key,
        },
      });

      expect(await handler.findExistingResult(op, ctx)).toBeNull();
      const outcome = expectApplied(await handler.execute(op, ctx));
      expect(await handler.findExistingResult(op, ctx)).toEqual(outcome);
    });
  });

  describe('per-page notifications', () => {
    it('sends neither the in-app notification to subscribers nor a global notification when only execute runs (perPageNotifications false)', async () => {
      const spies = installNotificationSpies();
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      await subscribe(page);
      const op = await editOp(page);

      await handler.execute(op, contextFor(op, false));
      await waitForPageOperationsToFinish();

      expect(await countUpdateNotifications(page._id)).toBe(0);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
      expect(spies.userFire).not.toHaveBeenCalled();
    });

    it('notifies subscribers in-app with the requester as the operator and sends the edit global notification, but no per-save Slack notification', async () => {
      const spies = installNotificationSpies();
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      await subscribe(page);
      const op = await editOp(page);
      const ctx = contextFor(op, true);
      const outcome = expectApplied(await handler.execute(op, ctx));

      await handler.sendPerPageNotifications(op, outcome, ctx);

      await vi.waitFor(
        async () => {
          expect(await countUpdateNotifications(page._id)).toBe(1);
        },
        { timeout: 5000, interval: 50 },
      );
      const activity = await prisma.activities.findFirst({
        where: {
          ip: TEST_IP,
          target: page._id.toString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
        },
      });
      expect(activity?.userId).toBe(requester._id.toString());
      expect(activity?.endpoint).toBe(TEST_ENDPOINT);
      expect(spies.mailFire).toHaveBeenCalledTimes(1);
      expect(spies.mailFire).toHaveBeenCalledWith(
        GlobalNotificationSettingEvent.PAGE_EDIT,
        expect.objectContaining({ _id: page._id }),
        expect.objectContaining({ username: REQUESTER_USERNAME }),
        expect.anything(),
      );
      expect(spies.slackFire).toHaveBeenCalledTimes(1);
      expect(spies.userFire).not.toHaveBeenCalled();
    });

    it('clears the pending activity context when the same user updated the page within the suppression window, and still sends the global notification', async () => {
      const spies = installNotificationSpies();
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      const ctx = contextFor(op, true);
      const outcome = expectApplied(await handler.execute(op, ctx));
      await prisma.activities.create({
        data: {
          id: new mongoose.Types.ObjectId().toString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(),
          endpoint: TEST_ENDPOINT,
          ip: TEST_IP,
          snapshot: {
            id: new mongoose.Types.ObjectId().toString(),
            username: REQUESTER_USERNAME,
          },
          userId: requester._id.toString(),
          target: page._id.toString(),
        },
      });
      const clear = vi.spyOn(pendingActivityContext, 'clear');

      await handler.sendPerPageNotifications(op, outcome, ctx);

      expect(clear).toHaveBeenCalledTimes(1);
      const [clearedActivityId] = clear.mock.calls[0];
      expect(pendingActivityContext.take(clearedActivityId)).toBeUndefined();
      expect(
        await prisma.activities.count({
          where: {
            ip: TEST_IP,
            target: page._id.toString(),
            action: SupportedAction.ACTION_PAGE_UPDATE,
          },
        }),
      ).toBe(1);
      expect(spies.mailFire).toHaveBeenCalledTimes(1);
    });

    it('sends no global notification for a page only people with the link can view', async () => {
      const spies = installNotificationSpies();
      const handler = createEditHandler(crowi);
      const page = await createPage(other, PageGrant.GRANT_RESTRICTED);
      const op = await editOp(page);
      const ctx = contextFor(op, true);
      const outcome = expectApplied(await handler.execute(op, ctx));

      await handler.sendPerPageNotifications(op, outcome, ctx);

      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
    });

    it('does not throw when sending fails', async () => {
      installNotificationSpies();
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      const ctx = contextFor(op, true);
      const outcome = expectApplied(await handler.execute(op, ctx));
      vi.spyOn(crowi.globalNotificationService, 'fire').mockRejectedValue(
        new Error('smtp down'),
      );

      await expect(
        handler.sendPerPageNotifications(op, outcome, ctx),
      ).resolves.toBeUndefined();
    });

    it('does not throw when the applied page is gone', async () => {
      const spies = installNotificationSpies();
      const handler = createEditHandler(crowi);
      const page = await createPage(other);
      const op = await editOp(page);
      const ctx = contextFor(op, true);

      await expect(
        handler.sendPerPageNotifications(
          op,
          {
            status: 'applied',
            resultPageId: new mongoose.Types.ObjectId().toString(),
            resultRevisionId: null,
          },
          ctx,
        ),
      ).resolves.toBeUndefined();
      expect(spies.mailFire).not.toHaveBeenCalled();
    });
  });
});
