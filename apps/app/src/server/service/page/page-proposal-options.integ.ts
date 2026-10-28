import type { IRevisionProposalMark, IUserHasId } from '@growi/core';
import { SubscriptionStatusType } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { RevisionConflictError } from '~/server/models/errors';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import Subscription from '~/server/models/subscription';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

const PREFIX = '/page-proposal-options-integ';
const TEST_IP = '10.0.0.123';
const TEST_ENDPOINT = '/_api/v3/page-proposal-options-integ';
const ACTOR_USERNAME = 'pageProposalOptionsActor';
const SUBSCRIBER_USERNAME = 'pageProposalOptionsSubscriber';

// Long enough for a not-awaited 'updated' listener to have written a
// notification if one had been emitted.
const NEGATIVE_SETTLE_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('PageService options used by change proposals', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let actor: HydratedDocument<IUserHasId>;
  let subscriber: HydratedDocument<IUserHasId>;
  let pageSeq = 0;

  const activityParameters = { ip: TEST_IP, endpoint: TEST_ENDPOINT };

  const nextPath = (): string => {
    pageSeq += 1;
    return `${PREFIX}/page-${pageSeq}`;
  };

  const createSubscribedPage = async (): Promise<
    HydratedDocument<PageDocument>
  > => {
    const page = await crowi.pageService.create(nextPath(), 'body', actor, {});
    await Subscription.subscribeByPageId(
      new mongoose.Types.ObjectId(subscriber._id),
      page._id,
      SubscriptionStatusType.SUBSCRIBE,
    );
    await waitForPageOperationsToFinish();
    return page;
  };

  const findPage = async (
    pageId: mongoose.Types.ObjectId,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.findById(pageId);
    if (page == null) {
      throw new Error(`page ${pageId} not found`);
    }
    return page;
  };

  const countNotifications = (
    pageId: mongoose.Types.ObjectId,
    action: string,
  ): Promise<number> =>
    InAppNotification.countDocuments({
      user: subscriber._id,
      target: pageId,
      action,
    }).exec();

  const countActivities = (pageId: mongoose.Types.ObjectId, action: string) =>
    prisma.activities.count({
      where: { ip: TEST_IP, target: pageId.toString(), action },
    });

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
    actor = await User.create({
      name: ACTOR_USERNAME,
      username: ACTOR_USERNAME,
      email: 'page-proposal-options-actor@example.com',
      status: UserStatus.STATUS_ACTIVE,
    });
    subscriber = await User.create({
      name: SUBSCRIBER_USERNAME,
      username: SUBSCRIBER_USERNAME,
      email: 'page-proposal-options-subscriber@example.com',
      status: UserStatus.STATUS_ACTIVE,
    });
  });

  beforeEach(() => {
    // Page events have async listeners unrelated to what is under test;
    // the activity emitter is left real because it is what is under test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await waitForPageOperationsToFinish();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const pages = await Page.find({
      path: new RegExp(`^(/trash)?${PREFIX}/`),
    });
    const pageIds = pages.map((p) => p._id);
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pageIds.map((id) => id.toString()) } },
    });
    await InAppNotification.deleteMany({ target: { $in: pageIds } });
    await Subscription.deleteMany({ target: { $in: pageIds } });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: `${PREFIX}/` } },
    });
    await mongoose
      .model('User')
      .deleteMany({ username: { $in: [ACTOR_USERNAME, SUBSCRIBER_USERNAME] } });
    await configManager.updateConfigs(
      { 'app:isV5Compatible': undefined, 'app:auditLogEnabled': undefined },
      { removeIfUndefined: true },
    );
  });

  describe('create with proposalMark', () => {
    it('stores the mark on the first revision and not on the page', async () => {
      const proposalMark: IRevisionProposalMark = {
        proposalId: new mongoose.Types.ObjectId().toString(),
        proposalOperationKey: 'op-create-1',
      };

      const page = await crowi.pageService.create(
        nextPath(),
        'proposed body',
        actor,
        { proposalMark },
      );

      const revisions = await prisma.revisions.findMany({
        where: { pageId: page._id.toString() },
      });
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject(proposalMark);

      const rawPage = await Page.collection.findOne({ _id: page._id });
      expect(rawPage).not.toBeNull();
      expect(rawPage).not.toHaveProperty('proposalId');
      expect(rawPage).not.toHaveProperty('proposalOperationKey');
      expect(rawPage).not.toHaveProperty('proposalMark');
    });

    it('leaves the first revision unmarked when no mark is given', async () => {
      const page = await crowi.pageService.create(
        nextPath(),
        'body',
        actor,
        {},
      );

      const revision = await prisma.revisions.findFirst({
        where: { pageId: page._id.toString() },
      });
      expect(revision?.proposalId ?? null).toBeNull();
      expect(revision?.proposalOperationKey ?? null).toBeNull();
    });
  });

  describe('updatePage with proposalMark and expectedRevisionId', () => {
    it('writes a marked revision when the page is still at the expected revision', async () => {
      const created = await crowi.pageService.create(
        nextPath(),
        'before',
        actor,
        {},
      );
      const page = await findPage(created._id);
      const baseRevisionId = page.revision?.toString();
      const proposalMark: IRevisionProposalMark = {
        proposalId: new mongoose.Types.ObjectId().toString(),
        proposalOperationKey: 'op-edit-1',
      };

      await crowi.pageService.updatePage(page, 'after', 'before', actor, {
        expectedRevisionId: baseRevisionId,
        proposalMark,
      });

      const latest = await prisma.revisions.findUnique({
        where: { id: (await findPage(created._id)).revision?.toString() },
      });
      expect(latest?.body).toBe('after');
      expect(latest).toMatchObject(proposalMark);
      expect(latest?.id).not.toBe(baseRevisionId);
    });

    it('throws RevisionConflictError and leaves the page as is when the page moved on', async () => {
      const created = await crowi.pageService.create(
        nextPath(),
        'before',
        actor,
        {},
      );
      const staleRevisionId = (
        await findPage(created._id)
      ).revision?.toString();
      // Someone else saves in between.
      await crowi.pageService.updatePage(
        await findPage(created._id),
        'someone else',
        'before',
        actor,
        {},
      );
      const pageAfterOtherSave = await findPage(created._id);
      const winningRevisionId = pageAfterOtherSave.revision?.toString();
      await waitForPageOperationsToFinish();

      await expect(
        crowi.pageService.updatePage(
          pageAfterOtherSave,
          'proposed',
          'before',
          actor,
          {
            expectedRevisionId: staleRevisionId,
            proposalMark: {
              proposalId: new mongoose.Types.ObjectId().toString(),
              proposalOperationKey: 'op-edit-2',
            },
          },
        ),
      ).rejects.toBeInstanceOf(RevisionConflictError);

      const pageAfter = await findPage(created._id);
      expect(pageAfter.revision?.toString()).toBe(winningRevisionId);
      const proposedRevisions = await prisma.revisions.count({
        where: { pageId: created._id.toString(), body: 'proposed' },
      });
      expect(proposedRevisions).toBe(0);
    });
  });

  describe.each([
    {
      name: 'renamePage',
      action: SupportedAction.ACTION_PAGE_RENAME,
      // The main and the sub operation each emit once, with different snapshots.
      expectedNotifications: 2,
      prepare: (page: HydratedDocument<PageDocument>) => Promise.resolve(page),
      run: (
        page: HydratedDocument<PageDocument>,
        options: { isInAppNotificationSuppressed?: boolean },
      ) =>
        crowi.pageService.renamePage(
          page,
          `${page.path}-renamed`,
          actor,
          options,
          activityParameters,
        ),
    },
    {
      name: 'deletePage',
      action: SupportedAction.ACTION_PAGE_DELETE,
      expectedNotifications: 1,
      prepare: (page: HydratedDocument<PageDocument>) => Promise.resolve(page),
      run: (
        page: HydratedDocument<PageDocument>,
        options: { isInAppNotificationSuppressed?: boolean },
      ) =>
        crowi.pageService.deletePage(
          page,
          actor,
          options,
          false,
          activityParameters,
        ),
    },
    {
      name: 'deleteCompletely',
      action: SupportedAction.ACTION_PAGE_DELETE_COMPLETELY,
      expectedNotifications: 1,
      prepare: (page: HydratedDocument<PageDocument>) => Promise.resolve(page),
      run: (
        page: HydratedDocument<PageDocument>,
        options: { isInAppNotificationSuppressed?: boolean },
      ) =>
        crowi.pageService.deleteCompletely(
          page,
          actor,
          options,
          false,
          false,
          activityParameters,
        ),
    },
    {
      name: 'revertDeletedPage',
      action: SupportedAction.ACTION_PAGE_REVERT,
      expectedNotifications: 1,
      prepare: async (page: HydratedDocument<PageDocument>) => {
        await crowi.pageService.deletePage(
          page,
          actor,
          {},
          false,
          activityParameters,
        );
        return findPage(page._id);
      },
      run: (
        page: HydratedDocument<PageDocument>,
        options: { isInAppNotificationSuppressed?: boolean },
      ) =>
        crowi.pageService.revertDeletedPage(
          page,
          actor,
          options,
          false,
          activityParameters,
        ),
    },
  ])('$name in-app notifications', ({
    action,
    expectedNotifications,
    prepare,
    run,
  }) => {
    it('notifies the subscriber when suppression is not requested', async () => {
      const page = await prepare(await createSubscribedPage());

      await run(page, {});

      await vi.waitFor(
        async () => {
          expect(await countNotifications(page._id, action)).toBe(
            expectedNotifications,
          );
        },
        { timeout: 5000, interval: 50 },
      );
      expect(await countActivities(page._id, action)).toBe(1);
    });

    it('records the activity but creates no notification when suppressed', async () => {
      const page = await prepare(await createSubscribedPage());

      await run(page, { isInAppNotificationSuppressed: true });

      await vi.waitFor(
        async () => {
          expect(await countActivities(page._id, action)).toBe(1);
        },
        { timeout: 5000, interval: 50 },
      );
      await waitForPageOperationsToFinish();
      await sleep(NEGATIVE_SETTLE_MS);
      expect(await countNotifications(page._id, action)).toBe(0);
    });
  });
});
