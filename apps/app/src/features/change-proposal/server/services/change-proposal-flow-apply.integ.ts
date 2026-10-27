import { GroupType, getIdStringForRef, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { GlobalNotificationService } from '~/server/service/global-notification';
import type { UserNotificationService } from '~/server/service/user-notification';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  CreatableOperationInput,
} from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.181';
const TEST_ENDPOINT = '/_api/v3/cp-flow-apply-integ';
const PREFIX = '/cp-flow-apply-integ';
const BACKGROUND = { kind: 'background' } as const;
const GROUP_NAME = 'cpFlowApplyGroup';

describe('change proposal flow: create, approve page by page and apply', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let restoreServices: () => void = () => {};
  let groupId: mongoose.Types.ObjectId;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpFlowApplyRequester',
      subscriber: 'cpFlowApplySubscriber',
      other: 'cpFlowApplyOther',
    },
  });
  const { users } = kit;

  const editOf = (
    page: HydratedDocument<PageDocument>,
    body: string,
  ): CreatableOperationInput => {
    if (page.revision == null) throw new Error(`${page.path} has no revision`);
    return {
      type: 'edit',
      pageId: page._id.toString(),
      baseRevisionId: getIdStringForRef(page.revision),
      body,
    };
  };

  const moveOf = (
    page: HydratedDocument<PageDocument>,
    toPath: string,
  ): CreatableOperationInput => ({
    type: 'move',
    pageId: page._id.toString(),
    fromPath: page.path,
    toPath,
  });

  const createProposal = async (
    operations: readonly CreatableOperationInput[],
    perPageNotifications?: boolean,
  ): Promise<ChangeProposalDocument> => {
    const result = await service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations,
      perPageNotifications,
      request: { ip: TEST_IP, endpoint: TEST_ENDPOINT },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.apply).toBeNull();
    return kit.reload(result.value.proposalId);
  };

  const approve = async (
    proposalId: string,
    keys: readonly string[] | 'all',
  ) => {
    const result = await service.approve(
      proposalId,
      users.requester,
      keys,
      BACKGROUND,
    );
    await kit.waitForPageOperationsToFinish();
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const revisionsOf = (pageId: string) =>
    prisma.revisions.findMany({
      where: { pageId },
      orderBy: { createdAt: 'asc' },
    });

  const latestBodyOf = async (pageId: string): Promise<string | undefined> => {
    const page = await kit.findPage(pageId);
    const revision = await prisma.revisions.findUnique({
      where: { id: page.revision?.toString() },
    });
    return revision?.body;
  };

  const resultPageIdOf = (op: { resultPageId?: string }): string => {
    if (op.resultPageId == null) throw new Error('operation has no page');
    return op.resultPageId;
  };

  // A real global notification service whose grant check runs, with only the
  // mail/Slack senders stubbed (the integration Crowi has none).
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
    crowi.globalNotificationService = globalNotificationService;
    crowi.userNotificationService = mock<UserNotificationService>();
    return { mailFire, slackFire };
  };

  // The in-app notifications of a page save are created by a listener of this
  // event, so counting its emits proves their absence without waiting.
  const spyNotifyingEmits = () => {
    const emit = vi.spyOn(crowi.events.activity, 'emit');
    return (pageIds: readonly string[]): number =>
      emit.mock.calls.filter(
        ([event, , target]) =>
          event === 'updated' &&
          target instanceof Object &&
          '_id' in target &&
          pageIds.includes(String(target._id)),
      ).length;
  };

  const countSubscriberNotifications = (pageId: string, action: string) =>
    InAppNotification.countDocuments({
      user: users.subscriber._id,
      target: pageId,
      action,
    }).exec();

  const summaryNotificationsOf = async (proposalId: string) =>
    (await kit.aggregatedNotifications(proposalId)).map((n) => ({
      user: String(n.user),
      action: n.action,
      pages: kit.snapshotPagesOf(n),
      paths: (
        JSON.parse(n.snapshot) as { pages: { path: string }[] }
      ).pages.map((p) => p.path),
    }));

  const groupGrant = () => ({
    grant: PageGrant.GRANT_USER_GROUP,
    grantUserGroupIds: [{ item: groupId, type: GroupType.userGroup }],
  });

  const createGroupPage = async (path: string) => {
    const page = await crowi.pageService.create(
      path,
      'base body',
      users.other,
      groupGrant(),
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const expectGroupGrant = (page: PageDocument): void => {
    expect(page.grant).toBe(PageGrant.GRANT_USER_GROUP);
    expect(page.grantedGroups.map((g) => getIdStringForRef(g.item))).toEqual([
      groupId.toString(),
    ]);
  };

  const proposalsOfRequester = () =>
    prisma.changeproposals.findMany({
      where: { requester: users.requester._id.toString() },
      select: { id: true },
    });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    await configManager.updateConfigs({ 'app:auditLogEnabled': true });
    groupId = (await mongoose.model('UserGroup').create({ name: GROUP_NAME }))
      ._id;
    await mongoose.model('UserGroupRelation').insertMany(
      [users.requester, users.subscriber, users.other].map((u) => ({
        relatedGroup: groupId,
        relatedUser: u._id,
      })),
    );
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
  });

  beforeEach(async () => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    await configManager.updateConfigs({
      'changeProposal:autoApplyPolicy': 'none',
    });
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    restoreServices();
    restoreServices = () => {};
    vi.restoreAllMocks();
    await kit.resetPerPageNotificationsSetting();
    await configManager.updateConfigs(
      { 'changeProposal:autoApplyPolicy': undefined },
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    const ids = (await proposalsOfRequester()).map((p) => p.id);
    await InAppNotification.deleteMany({ target: { $in: ids } });
    await prisma.activities.deleteMany({ where: { target: { in: ids } } });
    await prisma.changeproposals.deleteMany({ where: { id: { in: ids } } });
    await prisma.pageredirects.deleteRedirectsFromPathTree(PREFIX);
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: groupId });
    await mongoose.model('UserGroup').deleteMany({ _id: groupId });
    await configManager.updateConfigs(
      { 'app:auditLogEnabled': undefined },
      { removeIfUndefined: true },
    );
    await kit.tearDown();
  });

  it('applies an edit, a create and a move approved page by page under Japanese paths in a group-only tree, with one summary per apply and no per-page notifications while the admin setting is off', async () => {
    const spies = installNotificationSpies();
    const notifyingEmits = spyNotifyingEmits();
    const parent = await createGroupPage(kit.nextPath('グループ　限定'));
    const edited = await createGroupPage(
      `${parent.path}/編集する　ページ（甲）`,
    );
    const moved = await createGroupPage(`${parent.path}/移動する　ページ`);
    await kit.subscribe(edited);
    await kit.subscribe(moved);
    const createdPath = `${parent.path}/新しい　ページ（乙）🚀`;
    const movedTo = `${parent.path}/移動先／ページ［丙］`;

    // perPageNotifications is left to its default ("send"), so only the admin setting holds them back.
    const proposal = await createProposal([
      editOf(edited, '# 提案した本文\r\n全角　スペース'),
      { type: 'create', path: createdPath, body: '作った本文' },
      moveOf(moved, movedTo),
    ]);
    expect(proposal.perPageNotifications).toBe(true);
    expect(proposal.operations.map((op) => op.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
    const [editKey, createKey, moveKey] = proposal.operations.map(
      (op) => op.key,
    );

    const summariesAfterEachApproval: number[] = [];
    for (const key of [editKey, createKey, moveKey]) {
      // biome-ignore lint/performance/noAwaitInLoops: the approvals are sequential on purpose
      const applied = await approve(proposal._id, [key]);
      expect(applied).toEqual({
        type: 'done',
        results: [{ key, status: 'applied' }],
      });
      summariesAfterEachApproval.push(
        (await kit.aggregatedNotifications(proposal._id)).length,
      );
    }

    const stored = await kit.reload(proposal._id);
    expect(stored.lifecycle).toBe('settled');
    for (const op of stored.operations) {
      expect(op.status).toBe('applied');
      expect(op.appliedAt).toBeInstanceOf(Date);
    }

    // edit: one marked revision by the requester, the page keeps its grant
    const editOp = kit.operationOf(stored, editKey);
    const [editRevision] = await kit.markedRevisions(proposal._id, editKey);
    expect(await kit.markedRevisions(proposal._id, editKey)).toHaveLength(1);
    expect(editOp.resultRevisionId).toBe(editRevision.id);
    expect(editRevision.authorId).toBe(users.requester._id.toString());
    const editedAfter = await kit.findPage(edited._id);
    expect(getIdStringForRef(editedAfter.revision ?? '')).toBe(editRevision.id);
    expectGroupGrant(editedAfter);
    expect(await latestBodyOf(edited._id.toString())).toBe(
      '# 提案した本文\n全角　スペース',
    );

    // create: inherits the parent grant; its first and only revision carries the mark
    const createdPageId = resultPageIdOf(kit.operationOf(stored, createKey));
    const createdPage = await kit.findPage(createdPageId);
    expect(createdPage.path).toBe(createdPath);
    expectGroupGrant(createdPage);
    expect(String(createdPage.creator)).toBe(users.requester._id.toString());
    const createdRevisions = await revisionsOf(createdPageId);
    expect(createdRevisions).toHaveLength(1);
    expect(createdRevisions[0]).toMatchObject({
      proposalId: proposal._id,
      proposalOperationKey: createKey,
      authorId: users.requester._id.toString(),
      body: '作った本文',
    });
    expect(kit.operationOf(stored, createKey).resultRevisionId).toBe(
      createdRevisions[0].id,
    );

    // move: no revision, the page keeps its grant and gets the new path
    expect(await kit.markedRevisions(proposal._id, moveKey)).toEqual([]);
    const movedAfter = await kit.findPage(moved._id);
    expect(movedAfter.path).toBe(movedTo);
    expectGroupGrant(movedAfter);

    // One summary per apply run, to the subscriber only; the create run has
    // nobody who a human save of a brand-new page would have notified.
    expect(summariesAfterEachApproval).toEqual([1, 1, 2]);
    expect(await summaryNotificationsOf(proposal._id)).toEqual([
      {
        user: users.subscriber._id.toString(),
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
        pages: [edited._id.toString()],
        paths: [edited.path],
      },
      {
        user: users.subscriber._id.toString(),
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
        pages: [moved._id.toString()],
        paths: [movedTo],
      },
    ]);

    expect(
      notifyingEmits([
        edited._id.toString(),
        moved._id.toString(),
        createdPageId,
      ]),
    ).toBe(0);
    expect(spies.mailFire).not.toHaveBeenCalled();
    expect(spies.slackFire).not.toHaveBeenCalled();
  });

  it('keeps the operations applied before a stale one and still applies the rest of the run', async () => {
    const first = await kit.createPage('stale-first');
    const middle = await kit.createPage('stale-middle');
    const moved = await kit.createPage('stale-moved');
    const createdPath = kit.nextPath('stale-created');
    const movedTo = kit.nextPath('stale-moved-to');
    const proposal = await createProposal([
      editOf(first, 'first proposed'),
      editOf(middle, 'middle proposed'),
      { type: 'create', path: createdPath, body: 'created body' },
      moveOf(moved, movedTo),
    ]);
    await crowi.pageService.updatePage(
      await kit.findPage(middle._id),
      'human edit',
      null,
      users.other,
      {},
    );
    await kit.waitForPageOperationsToFinish();

    const result = await approve(proposal._id, 'all');

    expect(result).toEqual({
      type: 'done',
      results: proposal.operations.map((op, i) =>
        i === 1
          ? { key: op.key, status: 'stale', reason: 'base-revision-changed' }
          : { key: op.key, status: 'applied' },
      ),
    });
    const stored = await kit.reload(proposal._id);
    expect(stored.lifecycle).toBe('settled');
    expect(await latestBodyOf(first._id.toString())).toBe('first proposed');
    expect(await latestBodyOf(middle._id.toString())).toBe('human edit');
    expect(
      await kit.markedRevisions(proposal._id, stored.operations[1].key),
    ).toEqual([]);
    expect(
      (await kit.findPage(resultPageIdOf(stored.operations[2]))).path,
    ).toBe(createdPath);
    expect((await kit.findPage(moved._id)).path).toBe(movedTo);
  });

  describe('with per-page notifications enabled by the admin', () => {
    beforeEach(async () => {
      await configManager.updateConfigs({
        'changeProposal:perPageNotificationsEnabled': true,
      });
    });

    it('sends the per-page notifications of each operation as well as the summary', async () => {
      const spies = installNotificationSpies();
      const edited = await kit.createPage('通知/編集');
      const moved = await kit.createPage('通知/移動');
      await kit.subscribe(edited);
      await kit.subscribe(moved);
      const createdPath = kit.nextPath('通知/作成');
      const movedTo = kit.nextPath('通知/移動先');
      const proposal = await createProposal([
        editOf(edited, '通知される本文'),
        { type: 'create', path: createdPath, body: '作った本文' },
        moveOf(moved, movedTo),
      ]);

      await approve(proposal._id, 'all');

      await vi.waitFor(
        async () => {
          expect(
            await countSubscriberNotifications(
              edited._id.toString(),
              SupportedAction.ACTION_PAGE_UPDATE,
            ),
          ).toBe(1);
          expect(
            await countSubscriberNotifications(
              moved._id.toString(),
              SupportedAction.ACTION_PAGE_RENAME,
            ),
          ).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 50 },
      );
      const createdPageId = resultPageIdOf(
        (await kit.reload(proposal._id)).operations[1],
      );
      expect(
        spies.mailFire.mock.calls.map(([event, page]) => [
          event,
          String(page._id),
        ]),
      ).toEqual(
        expect.arrayContaining([
          [GlobalNotificationSettingEvent.PAGE_EDIT, edited._id.toString()],
          [GlobalNotificationSettingEvent.PAGE_CREATE, createdPageId],
          [GlobalNotificationSettingEvent.PAGE_MOVE, moved._id.toString()],
        ]),
      );
      expect(spies.mailFire).toHaveBeenCalledTimes(3);
      expect(await summaryNotificationsOf(proposal._id)).toEqual([
        {
          user: users.subscriber._id.toString(),
          action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
          pages: [edited._id.toString(), moved._id.toString()],
          paths: [edited.path, movedTo],
        },
      ]);
    });

    it('sends only the summary for a proposal created with per-page notifications turned off', async () => {
      const spies = installNotificationSpies();
      const notifyingEmits = spyNotifyingEmits();
      const edited = await kit.createPage('quiet-edit');
      const moved = await kit.createPage('quiet-move');
      await kit.subscribe(edited);
      await kit.subscribe(moved);
      const movedTo = kit.nextPath('quiet-moved-to');
      const proposal = await createProposal(
        [
          editOf(edited, 'quiet body'),
          { type: 'create', path: kit.nextPath('quiet-create'), body: 'x' },
          moveOf(moved, movedTo),
        ],
        false,
      );

      await approve(proposal._id, 'all');

      const createdPageId = resultPageIdOf(
        (await kit.reload(proposal._id)).operations[1],
      );
      expect(
        notifyingEmits([
          edited._id.toString(),
          moved._id.toString(),
          createdPageId,
        ]),
      ).toBe(0);
      expect(spies.mailFire).not.toHaveBeenCalled();
      expect(spies.slackFire).not.toHaveBeenCalled();
      expect(await summaryNotificationsOf(proposal._id)).toEqual([
        {
          user: users.subscriber._id.toString(),
          action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
          pages: [edited._id.toString(), moved._id.toString()],
          paths: [edited.path, movedTo],
        },
      ]);
    });
  });
});
