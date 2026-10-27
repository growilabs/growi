import type { IUserHasId } from '@growi/core';
import { GroupType, getIdStringForRef, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { GlobalNotificationService } from '~/server/service/global-notification';
import type { UserNotificationService } from '~/server/service/user-notification';
import { prisma } from '~/utils/prisma';

import { classifyCreateError } from './classify-create-error';
import { createCreateHandler } from './create';
import type {
  AppliedOutcome,
  OperationContext,
  OperationOutcome,
  OperationRecordOf,
} from './types';

const PREFIX = '/cp-create-handler-integ';
const TEST_IP = '10.0.0.143';
const TEST_ENDPOINT = '/_api/v3/cp-create-handler-integ';
const REQUESTER_USERNAME = 'cpCreateHandlerRequester';
const MEMBER_GROUP_NAME = 'cpCreateHandlerMemberGroup';
const FOREIGN_GROUP_NAME = 'cpCreateHandlerForeignGroup';

describe('create operation handler', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let requester: HydratedDocument<IUserHasId>;
  let memberGroupId: mongoose.Types.ObjectId;
  let foreignGroupId: mongoose.Types.ObjectId;
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

  const createParent = async (
    grant: PageGrant,
    groupIds: mongoose.Types.ObjectId[] = [],
  ): Promise<HydratedDocument<PageDocument>> => {
    const prefixPage = await Page.findOne({ path: PREFIX });
    return Page.create({
      path: nextPath(),
      grant,
      grantedGroups: groupIds.map((item) => ({
        item,
        type: GroupType.userGroup,
      })),
      parent: prefixPage?._id,
      isEmpty: false,
    });
  };

  const createOp = (path: string): OperationRecordOf<'create'> => ({
    type: 'create',
    index: 0,
    key: 'op-create',
    status: 'pending',
    path,
    body: 'proposed body',
  });

  const contextFor = (
    op: OperationRecordOf<'create'>,
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
    const root = await Page.findOne({ path: '/' });
    await Page.create({
      path: PREFIX,
      grant: Page.GRANT_PUBLIC,
      parent: root?._id,
      isEmpty: false,
    });

    const User = mongoose.model<IUserHasId>('User');
    requester = await User.create({
      name: REQUESTER_USERNAME,
      username: REQUESTER_USERNAME,
      email: `${REQUESTER_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });

    const UserGroup = mongoose.model('UserGroup');
    const UserGroupRelation = mongoose.model('UserGroupRelation');
    memberGroupId = (await UserGroup.create({ name: MEMBER_GROUP_NAME }))._id;
    foreignGroupId = (await UserGroup.create({ name: FOREIGN_GROUP_NAME }))._id;
    await UserGroupRelation.create({
      relatedGroup: memberGroupId,
      relatedUser: requester._id,
    });
  });

  let pageEventEmit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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
    await InAppNotification.deleteMany({ target: { $in: pageIds } });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Page.deleteMany({ _id: { $in: pageIds } });
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: { $in: [memberGroupId, foreignGroupId] } });
    await mongoose
      .model('UserGroup')
      .deleteMany({ _id: { $in: [memberGroupId, foreignGroupId] } });
    await mongoose.model('User').deleteMany({ username: REQUESTER_USERNAME });
    await configManager.updateConfigs(
      { 'app:isV5Compatible': undefined, 'app:auditLogEnabled': undefined },
      { removeIfUndefined: true },
    );
  });

  describe('execute', () => {
    it('creates the page as the requester with the parent grant, marking only the first revision, and emits the page create event', async () => {
      const handler = createCreateHandler(crowi);
      const parent = await createParent(PageGrant.GRANT_USER_GROUP, [
        memberGroupId,
      ]);
      const op = createOp(`${parent.path}/child`);
      const ctx = contextFor(op, false);

      const outcome = expectApplied(await handler.execute(op, ctx));
      await waitForPageOperationsToFinish();

      const created = await Page.findOne({ path: op.path });
      expect(created).not.toBeNull();
      if (created == null || created.revision == null) {
        throw new Error('created page or its revision is missing');
      }
      expect(outcome).toEqual({
        status: 'applied',
        resultPageId: created._id.toString(),
        resultRevisionId: getIdStringForRef(created.revision),
      });
      expect(created.creator?.toString()).toBe(requester._id.toString());
      expect(created.grant).toBe(PageGrant.GRANT_USER_GROUP);
      expect(
        created.grantedGroups.map((g) => getIdStringForRef(g.item)),
      ).toEqual([memberGroupId.toString()]);
      expect(created.wip).toBeFalsy();

      const revisions = await prisma.revisions.findMany({
        where: { pageId: created._id.toString() },
      });
      expect(revisions).toHaveLength(1);
      expect(revisions[0]).toMatchObject({
        body: 'proposed body',
        authorId: requester._id.toString(),
        origin: null,
        proposalId: ctx.proposalId,
        proposalOperationKey: op.key,
      });
      const rawPage = await Page.collection.findOne({ _id: created._id });
      expect(rawPage).not.toHaveProperty('proposalId');
      expect(rawPage).not.toHaveProperty('proposalOperationKey');
      expect(crowi.events.page).toBe(crowi.pageService.pageEvent);
      expect(pageEventEmit).toHaveBeenCalledWith(
        'create',
        expect.objectContaining({ path: op.path }),
        expect.anything(),
      );
    });

    it('fails with path-occupied and writes nothing when a non-empty page already exists at the path', async () => {
      const handler = createCreateHandler(crowi);
      const parent = await createParent(PageGrant.GRANT_PUBLIC);
      const op = createOp(parent.path);
      const ctx = contextFor(op, false);

      const outcome = await handler.execute(op, ctx);

      expect(outcome).toEqual({ status: 'failed', reason: 'path-occupied' });
      expect(
        await prisma.revisions.count({ where: { proposalId: ctx.proposalId } }),
      ).toBe(0);
    });

    it('fails with target-unavailable when the requester cannot view the closest ancestor', async () => {
      const handler = createCreateHandler(crowi);
      const parent = await createParent(PageGrant.GRANT_USER_GROUP, [
        foreignGroupId,
      ]);
      const op = createOp(`${parent.path}/child`);
      const ctx = contextFor(op, false);

      const outcome = await handler.execute(op, ctx);

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'target-unavailable',
      });
      expect(await Page.exists({ path: op.path })).toBeNull();
    });

    it('fails with grant-not-assignable when the page service refuses the inherited grant', async () => {
      const handler = createCreateHandler(crowi);
      const parent = await createParent(PageGrant.GRANT_PUBLIC);
      const op = createOp(`${parent.path}/child`);
      vi.spyOn(crowi.pageService, 'create').mockRejectedValue(
        new Error('The user does not belong to any of the granted groups'),
      );

      const outcome = await handler.execute(op, contextFor(op, false));

      expect(outcome).toEqual({
        status: 'failed',
        reason: 'grant-not-assignable',
      });
    });
  });

  describe('the refusals pageService.create actually throws', () => {
    const classifyRefusal = async (
      path: string,
      options: Parameters<Crowi['pageService']['create']>[3],
    ) => {
      try {
        await crowi.pageService.create(path, 'body', requester, options);
      } catch (err) {
        return classifyCreateError(err);
      }
      throw new Error(`creating ${path} unexpectedly succeeded`);
    };

    it('classifies inheriting groups the requester is not in as grant-not-assignable', async () => {
      const parent = await createParent(PageGrant.GRANT_USER_GROUP, [
        foreignGroupId,
      ]);

      expect(await classifyRefusal(`${parent.path}/child`, {})).toBe(
        'grant-not-assignable',
      );
    });

    it('classifies an empty group list as grant-not-assignable', async () => {
      const parent = await createParent(PageGrant.GRANT_PUBLIC);

      expect(
        await classifyRefusal(`${parent.path}/child`, {
          grant: PageGrant.GRANT_USER_GROUP,
          grantUserGroupIds: [],
        }),
      ).toBe('grant-not-assignable');
    });

    it('classifies an occupied path as not-processable', async () => {
      const parent = await createParent(PageGrant.GRANT_PUBLIC);

      expect(await classifyRefusal(parent.path, {})).toBe('not-processable');
    });
  });

  describe('findExistingResult', () => {
    it('finds nothing before the write and the created page after it, so a re-run does not create twice', async () => {
      const handler = createCreateHandler(crowi);
      const parent = await createParent(PageGrant.GRANT_PUBLIC);
      const op = createOp(`${parent.path}/child`);
      const ctx = contextFor(op, false);

      expect(await handler.findExistingResult(op, ctx)).toBeNull();
      const applied = await handler.execute(op, ctx);
      await waitForPageOperationsToFinish();

      expect(await handler.findExistingResult(op, ctx)).toEqual(applied);
    });
  });

  describe('per-page notifications', () => {
    it('sends no global notification when only execute runs (perPageNotifications false)', async () => {
      const spies = installNotificationSpies();
      const handler = createCreateHandler(crowi);
      const parent = await createParent(PageGrant.GRANT_PUBLIC);
      const op = createOp(`${parent.path}/child`);

      await handler.execute(op, contextFor(op, false));
      await waitForPageOperationsToFinish();

      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
      expect(spies.userFire).not.toHaveBeenCalled();
    });

    it('sends only the create global notification: no in-app notification and no per-save Slack notification', async () => {
      const spies = installNotificationSpies();
      const handler = createCreateHandler(crowi);
      const parent = await createParent(PageGrant.GRANT_PUBLIC);
      const op = createOp(`${parent.path}/child`);
      const ctx = contextFor(op, true);
      const outcome = expectApplied(await handler.execute(op, ctx));

      await handler.sendPerPageNotifications(op, outcome, ctx);
      await waitForPageOperationsToFinish();

      expect(spies.mailFire).toHaveBeenCalledTimes(1);
      expect(spies.mailFire).toHaveBeenCalledWith(
        GlobalNotificationSettingEvent.PAGE_CREATE,
        expect.objectContaining({ path: op.path }),
        expect.objectContaining({ username: REQUESTER_USERNAME }),
        expect.anything(),
      );
      expect(spies.slackFire).toHaveBeenCalledTimes(1);
      expect(spies.userFire).not.toHaveBeenCalled();
      expect(
        await InAppNotification.countDocuments({
          target: new mongoose.Types.ObjectId(outcome.resultPageId),
        }),
      ).toBe(0);
    });
  });
});
