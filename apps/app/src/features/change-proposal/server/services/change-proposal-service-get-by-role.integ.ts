import { randomUUID } from 'node:crypto';
import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalSummaryView,
  ChangeProposalView,
  OperationView,
  ReviewerRef,
} from '../../interfaces';
import type {
  AttributedApproval,
  CreateOperationInput,
} from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { ServiceResult } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.171';
const PREFIX = '/cp-service-get-by-role-integ';
const BACKGROUND = { kind: 'background' } as const;
const GROUP_MEMBER_USERNAME = 'cpGetByRoleGroupMember';
const GROUP_NAME = 'cpGetByRoleGroup';
const NOT_FOUND = { ok: false, error: { code: 'not-found' } };

describe('ChangeProposalService reads by viewer role', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let groupMember: HydratedDocument<IUserHasId>;
  let groupId: string;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpGetByRoleRequester',
      subscriber: 'cpGetByRoleReviewer',
      other: 'cpGetByRoleOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');

  const viewOf = (result: ServiceResult<ChangeProposalView>) => {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const keyOf = (proposal: ChangeProposalDocument, index: number): string => {
    const op = proposal.operations.find((o) => o.index === index);
    if (op == null) throw new Error(`operation ${index} not found`);
    return op.key;
  };

  const reviewerRef = (kind: ReviewerRef['kind'], id: string): ReviewerRef => ({
    kind,
    id,
    addedBy: users.requester._id.toString(),
    addedAt: new Date(),
  });

  const userReviewer = (user: IUserHasId): ReviewerRef =>
    reviewerRef('user', user._id.toString());

  const requesterIdentity = () => ({
    userId: users.requester._id.toString(),
    userGroupIds: new Set<string>(),
    externalUserGroupIds: new Set<string>(),
  });

  const applyKeys = async (
    proposal: ChangeProposalDocument,
    keys: readonly string[],
    approver: string | AttributedApproval = proposal.requester,
  ): Promise<ChangeProposalDocument> => {
    await prisma.changeproposals.markApproved(
      proposal._id,
      approver,
      keys,
      new Date(),
    );
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  // Viewable by the requester alone.
  const hiddenPage = async (label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.requester,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const pendingProposal = (
    operations: readonly CreateOperationInput[],
    reviewers: readonly ReviewerRef[],
  ) => kit.storeProposal(operations, { approve: false, reviewers });

  const appliedItemOf = async (
    viewer: IUserHasId,
    proposalId: string,
  ): Promise<ChangeProposalSummaryView | undefined> => {
    const { items } = await service.listAppliedVisible(viewer, null, 50);
    return items.find((item) => item.id === proposalId);
  };

  // A participant's own additions (Req 17.8, 19.7), outside what 5.10 keeps.
  const PARTICIPANT_FIELDS: ReadonlySet<string> = new Set([
    'approval',
    'rejections',
    'abstentions',
  ]);
  const withoutParticipantFields = (op: OperationView) =>
    Object.fromEntries(
      Object.entries(op).filter(([field]) => !PARTICIPANT_FIELDS.has(field)),
    );

  // What Req 19.10 keeps: the applied operations shown and the state read from them.
  const appliedViewFacts = (view: ChangeProposalView) => ({
    operations: view.operations.map(withoutParticipantFields),
    status: view.status,
    lastAppliedAt: view.lastAppliedAt,
    requesterState: view.requesterState,
  });
  const appliedItemFacts = (item: ChangeProposalSummaryView) => ({
    viewerRole: item.viewerRole,
    pages: item.pages,
    status: item.status,
    lastAppliedAt: item.lastAppliedAt,
  });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
    groupMember = await mongoose.model<IUserHasId>('User').create({
      name: GROUP_MEMBER_USERNAME,
      username: GROUP_MEMBER_USERNAME,
      email: `${GROUP_MEMBER_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
    groupId = (await UserGroup.create({ name: GROUP_NAME }))._id.toString();
    await UserGroupRelation.create({
      relatedGroup: groupId,
      relatedUser: groupMember._id,
    });
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.changeproposals.deleteMany({
      where: { requester: users.requester._id.toString() },
    });
    await UserGroupRelation.deleteMany({ relatedGroup: groupId });
    await UserGroup.deleteMany({ _id: groupId });
    await mongoose.model('User').deleteMany({ _id: groupMember._id });
    await Page().deleteMany({ path: new RegExp(`^${PREFIX}(/|$)`) });
    await kit.tearDown();
  });

  describe('a reviewer', () => {
    it('gets a pending proposal with only the operations on pages they may view (Req 19.1, 19.6)', async () => {
      const shared = await kit.createPage('reviewer-shared');
      const hidden = await hiddenPage('reviewer-hidden');
      const proposal = await pendingProposal(
        [
          kit.editInput(shared, 'shared body'),
          kit.editInput(hidden, 'hidden body'),
          { type: 'create', path: `${hidden.path}/child`, body: 'new child' },
        ],
        [userReviewer(users.subscriber)],
      );

      const view = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );

      expect(view).toMatchObject({
        viewerRole: 'reviewer',
        isRequester: false,
        status: 'pending',
      });
      expect(view).not.toHaveProperty('requesterState');
      expect(view.operations.map((op) => op.key)).toEqual([keyOf(proposal, 0)]);
      expect(view.operations[0]).not.toHaveProperty('index');
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain(hidden.path);
      expect(serialized).not.toContain(keyOf(proposal, 1));
      expect(serialized).not.toContain(keyOf(proposal, 2));
    });

    it('is a reviewer through a group they belong to (Req 19.1)', async () => {
      const shared = await kit.createPage('group-shared');
      const proposal = await pendingProposal(
        [kit.editInput(shared)],
        [reviewerRef('user-group', groupId)],
      );

      const view = viewOf(
        await service.getForViewer(proposal._id, groupMember),
      );

      expect(view.viewerRole).toBe('reviewer');
      expect(view.operations.map((op) => op.key)).toEqual([keyOf(proposal, 0)]);
    });

    it('reads the overall status from the visible operations alone, never the actual stage (Req 19.6)', async () => {
      const occupied = await kit.createPage('status-occupied');
      const hidden = await hiddenPage('status-hidden');
      const proposal = await pendingProposal(
        [
          { type: 'create', path: occupied.path, body: 'collides' },
          kit.editInput(hidden),
        ],
        [userReviewer(users.subscriber)],
      );
      const stored = await applyKeys(proposal, [keyOf(proposal, 0)]);
      expect(stored.operations.map((op) => op.status)).toEqual([
        'failed',
        'pending',
      ]);

      const whileOpen = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );
      expect(
        await service.discard(proposal._id, users.requester),
      ).toMatchObject({ ok: true });
      const afterDiscard = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );
      const forRequester = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );

      // Same as a proposal holding the failed create alone.
      expect(whileOpen.status).toBe('not-applied');
      expect(afterDiscard.status).toBe('not-applied');
      expect(forRequester.status).toBe('discarded');
    });

    it('is answered exactly as for a missing proposal when no operation is on a page they may view (Req 19.4)', async () => {
      const hidden = await hiddenPage('none-hidden');
      const proposal = await pendingProposal(
        [kit.editInput(hidden)],
        [userReviewer(users.subscriber)],
      );

      const [forReviewer, missing] = await Promise.all([
        service.getForViewer(proposal._id, users.subscriber),
        service.getForViewer(
          new mongoose.Types.ObjectId().toString(),
          users.subscriber,
        ),
      ]);

      expect(forReviewer).toEqual(NOT_FOUND);
      expect(forReviewer).toEqual(missing);
    });
  });

  describe('a viewer who is neither the requester nor a reviewer', () => {
    it('never gets a pending operation, even on a page they may view (Req 19.3)', async () => {
      const applied = await kit.createPage('other-applied');
      const waiting = await kit.createPage('other-waiting');
      const onlyPending = await pendingProposal(
        [kit.editInput(waiting)],
        [userReviewer(groupMember)],
      );
      const partly = await pendingProposal(
        [kit.editInput(applied), kit.editInput(waiting)],
        [userReviewer(groupMember)],
      );
      await applyKeys(partly, [keyOf(partly, 0)]);

      const view = viewOf(await service.getForViewer(partly._id, users.other));

      expect(await service.getForViewer(onlyPending._id, users.other)).toEqual(
        NOT_FOUND,
      );
      expect(view).toMatchObject({ viewerRole: 'other', status: 'applied' });
      expect(view.operations.map((op) => op.key)).toEqual([keyOf(partly, 0)]);
      expect(JSON.stringify(view)).not.toContain(keyOf(partly, 1));
      expect((await appliedItemOf(users.other, partly._id))?.pages).toEqual([
        { id: applied._id.toString(), path: applied.path },
      ]);
    });
  });

  describe('an applied proposal read before and after the viewer becomes a reviewer', () => {
    const addSubscriberAsReviewer = async (proposalId: string) => {
      const result = await prisma.changeproposals.addReviewers(
        proposalId,
        requesterIdentity(),
        [{ kind: 'user', id: users.subscriber._id.toString() }],
        new Date(),
      );
      expect(result).toMatchObject({ ok: true });
    };

    it('returns the same applied operations and state in get and the applied list (Req 19.10)', async () => {
      const applied = await kit.createPage('before-after-applied');
      const hidden = await hiddenPage('before-after-hidden');
      const proposal = await pendingProposal(
        [kit.editInput(applied), kit.editInput(hidden)],
        [],
      );
      await applyKeys(proposal, [keyOf(proposal, 0)], {
        approver: requesterIdentity(),
        channel: 'ui',
        decisionToken: randomUUID(),
      });
      const read = async () => ({
        view: viewOf(
          await service.getForViewer(proposal._id, users.subscriber),
        ),
        item: await appliedItemOf(users.subscriber, proposal._id),
      });

      const before = await read();
      await addSubscriberAsReviewer(proposal._id);
      const after = await read();

      if (before.item == null || after.item == null) {
        throw new Error('the proposal is missing from the applied list');
      }
      expect(before.view.viewerRole).toBe('other');
      expect(after.view.viewerRole).toBe('reviewer');
      expect(after.item.viewerRole).toBe('other');
      expect(appliedViewFacts(after.view)).toEqual(
        appliedViewFacts(before.view),
      );
      expect(before.view.operations[0]).not.toHaveProperty('approval');
      expect(after.view.operations[0]?.approval).toMatchObject({
        by: { id: users.requester._id.toString() },
        byRequester: true,
      });
      expect(appliedItemFacts(after.item)).toEqual(
        appliedItemFacts(before.item),
      );
    });

    it('keeps the applied list on its applied operations while the get shows the reviewer a pending one (Req 19.1, 19.10)', async () => {
      const applied = await kit.createPage('list-applied');
      const waiting = await kit.createPage('list-waiting');
      const proposal = await pendingProposal(
        [kit.editInput(applied), kit.editInput(waiting)],
        [],
      );
      await applyKeys(proposal, [keyOf(proposal, 0)]);
      const itemBefore = await appliedItemOf(users.subscriber, proposal._id);

      await addSubscriberAsReviewer(proposal._id);
      const view = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );
      const itemAfter = await appliedItemOf(users.subscriber, proposal._id);

      expect(view.status).toBe('pending');
      expect(view.operations.map((op) => op.key)).toEqual([
        keyOf(proposal, 0),
        keyOf(proposal, 1),
      ]);
      if (itemBefore == null || itemAfter == null) {
        throw new Error('the proposal is missing from the applied list');
      }
      expect(appliedItemFacts(itemAfter)).toEqual(appliedItemFacts(itemBefore));
      expect(itemAfter).toMatchObject({
        viewerRole: 'other',
        status: 'applied',
        pages: [{ id: applied._id.toString(), path: applied.path }],
      });
    });
  });

  describe('group membership', () => {
    const spyMembershipReads = () => [
      vi.spyOn(UserGroupRelation, 'findAllUserGroupIdsRelatedToUser'),
      vi.spyOn(ExternalUserGroupRelation, 'findAllUserGroupIdsRelatedToUser'),
    ];

    it.each([
      ['the requester', () => users.requester],
      ['a reviewer', () => users.subscriber],
      ['another viewer', () => users.other],
    ])('is read once per get for %s, with a single viewing check', async (_label, viewerOf) => {
      const applied = await kit.createPage('membership-get-applied');
      const waiting = await kit.createPage('membership-get-waiting');
      const proposal = await pendingProposal(
        [
          kit.editInput(applied),
          kit.editInput(waiting),
          { type: 'create', path: `${waiting.path}/child`, body: 'new child' },
        ],
        [userReviewer(users.subscriber)],
      );
      await applyKeys(proposal, [keyOf(proposal, 0)]);
      const spies = spyMembershipReads();
      const findByIdsAndViewer = vi.spyOn(Page(), 'findByIdsAndViewer');

      viewOf(await service.getForViewer(proposal._id, viewerOf()));

      for (const spy of spies) {
        expect(spy).toHaveBeenCalledTimes(1);
      }
      expect(findByIdsAndViewer).toHaveBeenCalledTimes(1);
    });

    it('is read once for an applied list scanned over several batches', async () => {
      const scanning = createChangeProposalService(crowi, {
        applier: kit.newApplier(),
        appliedListScan: { batchSize: 1, limit: 3 },
      });
      for (const label of ['membership-list-1', 'membership-list-2']) {
        // biome-ignore lint/performance/noAwaitInLoops: two fixtures in order
        const page = await kit.createPage(label);
        const proposal = await pendingProposal([kit.editInput(page)], []);
        await applyKeys(proposal, [keyOf(proposal, 0)]);
      }
      const spies = spyMembershipReads();

      await scanning.listAppliedVisible(users.subscriber, null, 3);

      for (const spy of spies) {
        expect(spy).toHaveBeenCalledTimes(1);
      }
    });
  });
});
