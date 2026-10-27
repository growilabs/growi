import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant, SubscriptionStatusType } from '@growi/core';
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

import { createMoveHandler } from './move';
import type {
  AppliedOutcome,
  OperationContext,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const PREFIX = '/cp-move-handler-integ';
const TEST_IP = '10.0.0.144';
const TEST_ENDPOINT = '/_api/v3/cp-move-handler-integ';
const REQUESTER_USERNAME = 'cpMoveHandlerRequester';
const SUBSCRIBER_USERNAME = 'cpMoveHandlerSubscriber';
const OTHER_USERNAME = 'cpMoveHandlerOther';
const MEMBER_GROUP_NAME = 'cpMoveHandlerMemberGroup';

type MoveOperation = OperationRecordOf<'move'>;

describe('move operation handler', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let requester: HydratedDocument<IUserHasId>;
  let subscriber: HydratedDocument<IUserHasId>;
  let other: HydratedDocument<IUserHasId>;
  let memberGroupId: mongoose.Types.ObjectId;
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
    owner: IUserHasId = other,
    options: Parameters<Crowi['pageService']['create']>[3] = {},
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await crowi.pageService.create(path, 'body', owner, {
      grant: PageGrant.GRANT_PUBLIC,
      ...options,
    });
    await waitForPageOperationsToFinish();
    return findPage(page._id);
  };

  const moveOp = (
    page: HydratedDocument<PageDocument>,
    toPath: string,
    removeRedirectsFrom?: string,
  ): MoveOperation => ({
    type: 'move',
    index: 0,
    key: 'op-move',
    status: 'pending',
    pageId: page._id.toString(),
    fromPath: page.path,
    toPath,
    ...(removeRedirectsFrom == null ? {} : { removeRedirectsFrom }),
  });

  const contextFor = (
    op: MoveOperation,
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

  const redirectsFromTree = (path: string) =>
    prisma.pageredirects.findMany({
      where: {
        OR: [{ fromPath: path }, { fromPath: { startsWith: `${path}/` } }],
      },
    });

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

  const countRenameNotifications = (pageId: mongoose.Types.ObjectId) =>
    InAppNotification.countDocuments({
      user: subscriber._id,
      target: pageId,
      action: SupportedAction.ACTION_PAGE_RENAME,
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

    const UserGroup = mongoose.model('UserGroup');
    memberGroupId = (await UserGroup.create({ name: MEMBER_GROUP_NAME }))._id;
    await mongoose.model('UserGroupRelation').create({
      relatedGroup: memberGroupId,
      relatedUser: requester._id,
    });
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
    const pages = await Page.find({ path: new RegExp(`^${PREFIX}(/|$)`) });
    const pageIds = pages.map((p) => p._id);
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pageIds.map((id) => id.toString()) } },
    });
    await prisma.pageredirects.deleteRedirectsFromPathTree(PREFIX);
    await InAppNotification.deleteMany({ target: { $in: pageIds } });
    await Subscription.deleteMany({ target: { $in: pageIds } });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: memberGroupId });
    await mongoose.model('UserGroup').deleteMany({ _id: memberGroupId });
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
    it('moves the page as the requester, leaves a redirect from the source path, records the rename activity and emits the rename event', async () => {
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      const op = moveOp(page, `${page.path}-moved`);
      const ctx = contextFor(op, false);

      const outcome = await handler.execute(op, ctx);
      await waitForPageOperationsToFinish();

      expect(outcome).toEqual({
        status: 'applied',
        resultPageId: page._id.toString(),
        resultRevisionId: null,
      });
      const moved = await findPage(page._id);
      expect(moved.path).toBe(op.toPath);
      expect(moved.lastUpdateUser?.toString()).toBe(requester._id.toString());
      const redirect = await prisma.pageredirects.retrievePageRedirectEndpoints(
        op.fromPath,
      );
      expect(redirect?.end.toPath).toBe(op.toPath);
      const activity = await prisma.activities.findFirst({
        where: {
          ip: TEST_IP,
          target: page._id.toString(),
          action: SupportedAction.ACTION_PAGE_RENAME,
        },
      });
      expect(activity?.userId).toBe(requester._id.toString());
      expect(pageEventEmit).toHaveBeenCalledWith(
        'rename',
        expect.objectContaining({ oldPath: op.fromPath, newPath: op.toPath }),
      );
    });

    it('fails with path-occupied and leaves the page in place when a non-empty page is at the destination', async () => {
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      const occupant = await createPage(nextPath());
      const op = moveOp(page, occupant.path);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({ status: 'failed', reason: 'path-occupied' });
      expect((await findPage(page._id)).path).toBe(op.fromPath);
    });

    it('fails with target-unavailable when the requester cannot view the source page', async () => {
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath(), other, {
        grant: PageGrant.GRANT_OWNER,
      });
      const op = moveOp(page, `${page.path}-moved`);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'target-unavailable',
      });
      expect((await findPage(page._id)).path).toBe(op.fromPath);
    });

    it('fails with target-unavailable when the page is no longer at the source path', async () => {
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      const op: MoveOperation = {
        ...moveOp(page, `${page.path}-moved`),
        fromPath: `${page.path}-elsewhere`,
      };

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'target-unavailable',
      });
      expect((await findPage(page._id)).path).toBe(page.path);
    });

    it('fails with grant-not-assignable when the page service refuses the page grant under the destination parent', async () => {
      const handler = createMoveHandler(crowi);
      const groupParent = await createPage(nextPath(), requester, {
        grant: PageGrant.GRANT_USER_GROUP,
        grantUserGroupIds: [{ item: memberGroupId, type: GroupType.userGroup }],
      });
      const page = await createPage(nextPath());
      const op = moveOp(page, `${groupParent.path}/child`);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'grant-not-assignable',
      });
      expect((await findPage(page._id)).path).toBe(op.fromPath);
    });
  });

  describe('revert move', () => {
    it('moves a page with children back without a new redirect and removes the redirects from the original path and below it', async () => {
      const handler = createMoveHandler(crowi);
      const parent = await createPage(nextPath());
      const child = await createPage(`${parent.path}/child`);
      const originalPath = parent.path;
      const movedPath = `${originalPath}-moved`;
      const forward = moveOp(await findPage(parent._id), movedPath);
      expectApplied(await handler.execute(forward, contextFor(forward, false)));
      await waitForPageOperationsToFinish();
      expect(await redirectsFromTree(originalPath)).toHaveLength(2);

      const revert = moveOp(
        await findPage(parent._id),
        originalPath,
        originalPath,
      );
      const outcome = await handler.execute(revert, contextFor(revert, false));
      await waitForPageOperationsToFinish();

      expect(outcome).toEqual({
        status: 'applied',
        resultPageId: parent._id.toString(),
        resultRevisionId: null,
      });
      expect((await findPage(parent._id)).path).toBe(originalPath);
      expect((await findPage(child._id)).path).toBe(`${originalPath}/child`);
      expect(
        await prisma.pageredirects.retrievePageRedirectEndpoints(originalPath),
      ).toBeNull();
      expect(
        await prisma.pageredirects.retrievePageRedirectEndpoints(
          `${originalPath}/child`,
        ),
      ).toBeNull();
      expect(await redirectsFromTree(originalPath)).toHaveLength(0);
      expect(await redirectsFromTree(movedPath)).toHaveLength(0);
    });

    it('fails with moved-after-apply when the page has left the path the original move put it at', async () => {
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      const revert: MoveOperation = {
        ...moveOp(page, `${page.path}-original`, `${page.path}-original`),
        fromPath: `${page.path}-moved`,
      };

      const outcome = await handler.execute(revert, contextFor(revert, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'moved-after-apply',
      });
      expect((await findPage(page._id)).path).toBe(page.path);
    });
  });

  describe('with Japanese paths', () => {
    const japanesePath = (name: string): string => {
      seq += 1;
      return `${PREFIX}/日本語-${seq}/${name}`;
    };

    const redirectsFrom = async (paths: readonly string[]) =>
      (
        await prisma.pageredirects.findMany({
          where: { fromPath: { in: [...paths] } },
          select: { fromPath: true },
        })
      )
        .map((r) => r.fromPath)
        .sort();

    it.each([
      ['a full-width space', 'ページ　全角空白'],
      ['regex metacharacters and a full-width space', 'a.b(1)[仮]{2}|x　y'],
    ])('moves a page whose path has %s and its child there and back, removing exactly the redirects the move left', async (_label, name) => {
      const handler = createMoveHandler(crowi);
      const originalPath = japanesePath(name);
      const movedPath = `${PREFIX}/テスト/プロポーザル（かっこ）-${seq}`;
      const parent = await createPage(originalPath);
      const child = await createPage(`${originalPath}/子ページ`);
      const forward = moveOp(await findPage(parent._id), movedPath);
      expectApplied(await handler.execute(forward, contextFor(forward, false)));
      await waitForPageOperationsToFinish();
      expect((await findPage(child._id)).path).toBe(`${movedPath}/子ページ`);
      expect(
        (await prisma.pageredirects.retrievePageRedirectEndpoints(originalPath))
          ?.end.toPath,
      ).toBe(movedPath);
      // Differs from the moved tree only where an unescaped pattern would still
      // match (a literal `.` or `|`), so it must survive the redirect removal.
      const lookAlike = `${originalPath.replace(/[.　]/u, 'X')}/子ページ`;
      await prisma.pageredirects.create({
        data: { fromPath: lookAlike, toPath: movedPath },
      });

      const revert = moveOp(
        await findPage(parent._id),
        originalPath,
        originalPath,
      );
      const outcome = await handler.execute(revert, contextFor(revert, false));
      await waitForPageOperationsToFinish();

      expectApplied(outcome);
      expect((await findPage(parent._id)).path).toBe(originalPath);
      expect((await findPage(child._id)).path).toBe(`${originalPath}/子ページ`);
      expect(
        await redirectsFrom([
          originalPath,
          `${originalPath}/子ページ`,
          movedPath,
          `${movedPath}/子ページ`,
          lookAlike,
        ]),
      ).toEqual([lookAlike]);
    });

    it('fails with path-occupied when a page already sits at the Japanese destination', async () => {
      const handler = createMoveHandler(crowi);
      const page = await createPage(japanesePath('移動元'));
      const occupant = await createPage(japanesePath('ページ　全角空白'));
      const op = moveOp(page, occupant.path);

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({ status: 'failed', reason: 'path-occupied' });
      expect((await findPage(page._id)).path).toBe(op.fromPath);
    });
  });

  describe('findExistingResult', () => {
    it('finds nothing before the move and the applied result after it, so a re-run does not move twice', async () => {
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      const op = moveOp(page, `${page.path}-moved`);
      const ctx = contextFor(op, false);

      expect(await handler.findExistingResult(op, ctx)).toBeNull();
      const applied = await handler.execute(op, ctx);
      await waitForPageOperationsToFinish();

      expect(await handler.findExistingResult(op, ctx)).toEqual(applied);
    });

    it('finishes the redirect removal of a revert move that stopped right after moving the page', async () => {
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      const originalPath = page.path;
      const forward = moveOp(page, `${originalPath}-moved`);
      expectApplied(await handler.execute(forward, contextFor(forward, false)));
      await waitForPageOperationsToFinish();
      const revert = moveOp(
        await findPage(page._id),
        originalPath,
        originalPath,
      );
      await crowi.pageService.renamePage(
        await findPage(page._id),
        originalPath,
        requester,
        { createRedirectPage: false, updateMetadata: true },
        { ip: TEST_IP, endpoint: TEST_ENDPOINT },
      );
      await waitForPageOperationsToFinish();

      const outcome = await handler.findExistingResult(
        revert,
        contextFor(revert, false),
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
    it('sends no global notification from the page service itself, but notifies subscribers in-app when perPageNotifications is true', async () => {
      const spies = installNotificationSpies();
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      await subscribe(page);
      const notifyingEmits = spyNotifyingEmits(page._id);
      const op = moveOp(page, `${page.path}-moved`);

      expectApplied(await handler.execute(op, contextFor(op, true)));
      await waitForPageOperationsToFinish();

      await vi.waitFor(
        async () => {
          // A human rename notifies twice too (renamePage and its sub-operation each emit).
          expect(await countRenameNotifications(page._id)).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 50 },
      );
      expect(notifyingEmits()).toBeGreaterThan(0);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
      expect(spies.userFire).not.toHaveBeenCalled();
    });

    it('sends no in-app notification when perPageNotifications is false, and still records the rename activity', async () => {
      const spies = installNotificationSpies();
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      await subscribe(page);
      const notifyingEmits = spyNotifyingEmits(page._id);
      const op = moveOp(page, `${page.path}-moved`);

      expectApplied(await handler.execute(op, contextFor(op, false)));
      await waitForPageOperationsToFinish();

      expect(await countRenameNotifications(page._id)).toBe(0);
      expect(
        await prisma.activities.count({
          where: {
            ip: TEST_IP,
            target: page._id.toString(),
            action: SupportedAction.ACTION_PAGE_RENAME,
          },
        }),
      ).toBe(1);
      expect(notifyingEmits()).toBe(0);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
    });

    it('sends the move global notification with the old path, as the move route does', async () => {
      const spies = installNotificationSpies();
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      const op = moveOp(page, `${page.path}-moved`);
      const ctx = contextFor(op, true);
      const outcome = expectApplied(await handler.execute(op, ctx));

      await handler.sendPerPageNotifications(op, outcome, ctx);

      expect(spies.mailFire).toHaveBeenCalledTimes(1);
      expect(spies.mailFire).toHaveBeenCalledWith(
        GlobalNotificationSettingEvent.PAGE_MOVE,
        expect.objectContaining({ path: op.toPath }),
        expect.objectContaining({ username: REQUESTER_USERNAME }),
        { oldPath: op.fromPath },
      );
      expect(spies.slackFire).toHaveBeenCalledTimes(1);
      expect(spies.userFire).not.toHaveBeenCalled();
    });

    it('does not throw when the moved page is gone', async () => {
      const spies = installNotificationSpies();
      const handler = createMoveHandler(crowi);
      const page = await createPage(nextPath());
      const op = moveOp(page, `${page.path}-moved`);

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
