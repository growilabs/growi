import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ReviewerRef,
  ReviewResultNotificationSnapshot,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';
import { findReviewNotifications } from './review-notifications.test-kit';
import type { ReviewActor } from './reviewer-actions';

const PREFIX = '/cp-reviewer-approve-integ';
const BACKGROUND = { kind: 'background' } as const;
const GROUP_NAME = 'cpReviewerApproveGroup';
const NOT_OPEN = { ok: false, error: { code: 'not-open' } };

describe('ChangeProposalService.approve by a reviewer', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let groupId: string;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: '10.0.0.162',
    usernames: {
      requester: 'cpReviewerApproveRequester',
      subscriber: 'cpReviewerApproveReviewer',
      other: 'cpReviewerApproveOther',
    },
  });
  const { users } = kit;

  const actor = (user: IUserHasId): ReviewActor => ({
    user,
    channel: 'ui',
    trigger: BACKGROUND,
  });

  const userReviewer = (user: IUserHasId): ReviewerRef => ({
    kind: 'user',
    id: user._id.toString(),
    addedBy: users.requester._id.toString(),
    addedAt: new Date(),
  });

  const groupReviewer = (): ReviewerRef => ({
    kind: 'user-group',
    id: groupId,
    addedBy: users.requester._id.toString(),
    addedAt: new Date(),
  });

  const pendingProposal = (
    operations: readonly CreateOperationInput[],
    reviewers: readonly ReviewerRef[] = [userReviewer(users.subscriber)],
  ) => kit.storeProposal(operations, { approve: false, reviewers });

  const keysOf = (proposal: ChangeProposalDocument): string[] =>
    proposal.operations.map((op) => op.key);

  // Viewable by its owner alone.
  const ownedPage = async (label: string, owner: IUserHasId) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      owner,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  // Viewable and writable by the group's members (the reviewers), not by the requester.
  const groupPage = async (label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.subscriber,
      {
        grant: PageGrant.GRANT_USER_GROUP,
        grantUserGroupIds: [{ item: groupId, type: GroupType.userGroup }],
      },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const bodyOf = async (page: HydratedDocument<PageDocument>) => {
    const current = await kit.findPage(page._id);
    const revision = await prisma.revisions.findUnique({
      where: { id: current.revision?.toString() },
    });
    return revision?.body;
  };

  const approvalActivitiesOf = (proposalId: string) =>
    prisma.activities.findMany({
      where: {
        target: proposalId,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPROVE,
      },
    });

  // Activities settle asynchronously: wait for the first, then for any stray one.
  const settledApprovalActivitiesOf = async (proposalId: string) => {
    await vi.waitFor(
      async () => {
        if ((await approvalActivitiesOf(proposalId)).length === 0) {
          throw new Error('no approval activity yet');
        }
      },
      { timeout: 5000, interval: 50 },
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    return approvalActivitiesOf(proposalId);
  };

  const resultNotifications = (proposalId: string) =>
    findReviewNotifications('review-result', { target: proposalId });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    const group = await UserGroup.create({ name: GROUP_NAME });
    groupId = group._id.toString();
    await UserGroupRelation.create([
      { relatedGroup: group._id, relatedUser: users.subscriber._id },
      { relatedGroup: group._id, relatedUser: users.other._id },
    ]);
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    kit.editingPageIds.clear();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await UserGroupRelation.deleteMany({ relatedGroup: groupId });
    await UserGroup.deleteMany({ _id: groupId });
    await kit.tearDown();
  });

  describe('what a reviewer approves and how it is written', () => {
    it('applies the chosen operation with the requester as the author and records who approved it (Req 16.1, 16.8, 21.2)', async () => {
      const page = await kit.createPage('author');
      const left = await kit.createPage('author-left');
      const proposal = await pendingProposal([
        kit.editInput(page, 'reviewed body'),
        kit.editInput(left),
      ]);
      const [chosen, waiting] = keysOf(proposal);

      const result = await service.approve(
        proposal._id,
        { ...actor(users.subscriber), channel: 'api' },
        [chosen],
      );

      expect(result).toEqual({
        ok: true,
        value: { type: 'done', results: [{ key: chosen, status: 'applied' }] },
      });
      const stored = await kit.reload(proposal._id);
      expect(kit.operationOf(stored, chosen)).toMatchObject({
        status: 'applied',
        approvedBy: users.subscriber._id.toString(),
        approvedChannel: 'api',
        approvedAt: expect.any(Date),
      });
      expect(kit.operationOf(stored, waiting).approvedAt).toBeUndefined();
      const [revision] = await kit.markedRevisions(proposal._id, chosen);
      expect(revision.authorId).toBe(users.requester._id.toString());
      expect(await bodyOf(page)).toBe('reviewed body');
    });

    it('applies once when one member of a reviewer group approves, even with two members at once (Req 16.4, 16.5)', async () => {
      const page = await kit.createPage('group-race');
      const proposal = await pendingProposal(
        [kit.editInput(page, 'group body')],
        [groupReviewer()],
      );
      const [key] = keysOf(proposal);

      const answers = await Promise.all([
        service.approve(proposal._id, actor(users.subscriber)),
        service.approve(proposal._id, actor(users.other)),
      ]);

      // The later request either still saw the operation pending or saw it settled.
      expect(answers.some((answer) => answer.ok)).toBe(true);
      for (const answer of answers) {
        if (!answer.ok) expect(answer).toEqual(NOT_OPEN);
      }
      expect(await kit.markedRevisions(proposal._id, key)).toHaveLength(1);
      const op = kit.operationOf(await kit.reload(proposal._id), key);
      expect(op.status).toBe('applied');
      expect([
        users.subscriber._id.toString(),
        users.other._id.toString(),
      ]).toContain(op.approvedBy);
      expect(await resultNotifications(proposal._id)).toHaveLength(1);
      const approvals = await settledApprovalActivitiesOf(proposal._id);
      expect(approvals.map((row) => row.userId)).toEqual([op.approvedBy]);
    });

    it('lets the requester approve without being a reviewer, and does not notify them of their own approval (Req 16.3, 20.6)', async () => {
      const page = await kit.createPage('requester');
      const proposal = await pendingProposal([kit.editInput(page)]);
      const [key] = keysOf(proposal);

      const result = await service.approve(
        proposal._id,
        actor(users.requester),
      );

      expect(result).toEqual({
        ok: true,
        value: { type: 'done', results: [{ key, status: 'applied' }] },
      });
      expect(
        kit.operationOf(await kit.reload(proposal._id), key),
      ).toMatchObject({
        status: 'applied',
        approvedBy: users.requester._id.toString(),
      });
      expect(await resultNotifications(proposal._id)).toEqual([]);
    });

    it('sends the requester one result notification naming only what this request approved (Req 20.5)', async () => {
      const done = await kit.createPage('notified-done');
      const now = await kit.createPage('notified-now');
      const proposal = await pendingProposal([
        kit.editInput(done),
        kit.editInput(now),
      ]);
      const [doneKey, nowKey] = keysOf(proposal);
      await service.approve(proposal._id, actor(users.requester), [doneKey]);

      const result = await service.approve(
        proposal._id,
        actor(users.subscriber),
        [doneKey, nowKey],
      );

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [
            { key: doneKey, status: 'applied' },
            { key: nowKey, status: 'applied' },
          ],
        },
      });
      const [notification, ...rest] = await resultNotifications(proposal._id);
      expect(rest).toEqual([]);
      expect(notification.user.toString()).toBe(users.requester._id.toString());
      const snapshot: ReviewResultNotificationSnapshot = JSON.parse(
        notification.snapshot,
      );
      expect(snapshot.items).toEqual([{ path: now.path, result: 'approved' }]);
    });
  });

  it('notifies and records only the operation this request wrote, not one another approval already wrote (Req 20.5, 20.8)', async () => {
    const before = await kit.createPage('written-before');
    const now = await kit.createPage('written-now');
    const proposal = await pendingProposal([
      kit.editInput(before),
      kit.editInput(now),
    ]);
    const [beforeKey] = keysOf(proposal);
    // Approved by the requester and still waiting for its apply.
    await prisma.changeproposals.markApproved(
      proposal._id,
      proposal.requester,
      [beforeKey],
      new Date(),
    );

    await service.approve(proposal._id, actor(users.subscriber));

    const [notification, ...rest] = await resultNotifications(proposal._id);
    expect(rest).toEqual([]);
    const snapshot: ReviewResultNotificationSnapshot = JSON.parse(
      notification.snapshot,
    );
    expect(snapshot.items).toEqual([{ path: now.path, result: 'approved' }]);
    expect(await settledApprovalActivitiesOf(proposal._id)).toHaveLength(1);
  });

  describe('what a reviewer never reaches', () => {
    it('answers only for the operations the reviewer sees, though the apply also writes the hidden ones others approved (Req 16.2, 16.6, 19.6)', async () => {
      const shared = await kit.createPage('visible');
      const hidden = await ownedPage('hidden', users.requester);
      const proposal = await pendingProposal([
        kit.editInput(shared),
        kit.editInput(hidden),
      ]);
      const [sharedKey, hiddenKey] = keysOf(proposal);
      // The requester's approval of the hidden operation waits for the next apply.
      expect(
        await prisma.changeproposals.markApproved(
          proposal._id,
          proposal.requester,
          [hiddenKey],
          new Date(),
        ),
      ).toEqual({ ok: true });

      const result = await service.approve(
        proposal._id,
        actor(users.subscriber),
      );

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [{ key: sharedKey, status: 'applied' }],
        },
      });
      const stored = await kit.reload(proposal._id);
      expect(stored.operations.map((op) => op.status)).toEqual([
        'applied',
        'applied',
      ]);
      expect(kit.operationOf(stored, hiddenKey).approvedBy).toBeUndefined();
      const [notification] = await resultNotifications(proposal._id);
      const snapshot: ReviewResultNotificationSnapshot = JSON.parse(
        notification.snapshot,
      );
      expect(snapshot.items).toEqual([
        { path: shared.path, result: 'approved' },
      ]);
    });

    it('does not approve a hidden operation named by its key (Req 16.6, 21.4)', async () => {
      const shared = await kit.createPage('named-visible');
      const hidden = await ownedPage('named-hidden', users.requester);
      const proposal = await pendingProposal([
        kit.editInput(shared),
        kit.editInput(hidden),
      ]);
      const [, hiddenKey] = keysOf(proposal);

      const result = await service.approve(
        proposal._id,
        actor(users.subscriber),
        [hiddenKey],
      );

      expect(result).toEqual({
        ok: true,
        value: { type: 'done', results: [] },
      });
      const stored = await kit.reload(proposal._id);
      expect(stored.operations.map((op) => [op.status, op.approvedAt])).toEqual(
        [
          ['pending', undefined],
          ['pending', undefined],
        ],
      );
      expect(await resultNotifications(proposal._id)).toEqual([]);
    });

    it("writes with the requester's permission, so a page only the reviewer may write fails and stays unchanged (Req 21.1, 21.3, 21.4)", async () => {
      const page = await groupPage('reviewer-writable');
      const proposal = await pendingProposal(
        [kit.editInput(page, 'should not land')],
        [groupReviewer()],
      );
      const [key] = keysOf(proposal);

      const result = await service.approve(
        proposal._id,
        actor(users.subscriber),
      );

      if (!result.ok || result.value.type !== 'done') {
        throw new Error(JSON.stringify(result));
      }
      expect(result.value.results).toEqual([
        { key, status: 'failed', reason: 'target-unavailable' },
      ]);
      expect(await bodyOf(page)).toBe('base body');
      expect(await kit.markedRevisions(proposal._id, key)).toEqual([]);
    });
  });

  describe('operations and proposals that are not waiting', () => {
    it.each([
      'expired',
      'withdrawn',
    ] as const)('refuses a %s proposal as not open and writes nothing (Req 16.9)', async (closing) => {
      const page = await kit.createPage(`closed-${closing}`);
      // Only a proposal past its expiry closes as expired.
      const proposal = await kit.storeProposal([kit.editInput(page)], {
        approve: false,
        reviewers: [userReviewer(users.subscriber)],
        expiresAt: new Date(Date.now() - 1000),
      });
      expect(
        await prisma.changeproposals.closeIfStillOpen(
          proposal._id,
          closing,
          new Date(),
        ),
      ).toBe(true);

      expect(
        await service.approve(proposal._id, actor(users.subscriber)),
      ).toEqual(NOT_OPEN);
      const [op] = (await kit.reload(proposal._id)).operations;
      expect([op.status, op.approvedAt]).toEqual(['skipped', undefined]);
    });

    it('refuses a discarded and a settled proposal as not open (Req 16.9)', async () => {
      const discarded = await pendingProposal([
        kit.editInput(await kit.createPage('discarded')),
      ]);
      await service.discard(discarded._id, users.requester);
      const settled = await pendingProposal([
        kit.editInput(await kit.createPage('settled')),
      ]);
      await service.approve(settled._id, actor(users.requester));
      expect((await kit.reload(settled._id)).lifecycle).toBe('settled');

      expect(
        await service.approve(discarded._id, actor(users.subscriber)),
      ).toEqual(NOT_OPEN);
      expect(
        await service.approve(settled._id, actor(users.subscriber)),
      ).toEqual(NOT_OPEN);
    });

    it('leaves an operation pending and approvable again when someone is editing its page (Req 16.10, 21.6)', async () => {
      const page = await kit.createPage('being-edited');
      const proposal = await pendingProposal(
        [kit.editInput(page, 'after editing')],
        [groupReviewer()],
      );
      const [key] = keysOf(proposal);
      kit.editingPageIds.add(page._id.toString());

      const first = await service.approve(
        proposal._id,
        actor(users.subscriber),
      );

      expect(first).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [{ key, status: 'pending', reason: 'page-being-edited' }],
        },
      });
      const waiting = kit.operationOf(await kit.reload(proposal._id), key);
      expect([
        waiting.status,
        waiting.approvedAt,
        waiting.approvedBy,
        waiting.decisionToken,
      ]).toEqual(['pending', undefined, undefined, undefined]);

      kit.editingPageIds.clear();
      const second = await service.approve(proposal._id, actor(users.other));

      expect(second).toEqual({
        ok: true,
        value: { type: 'done', results: [{ key, status: 'applied' }] },
      });
      expect(await bodyOf(page)).toBe('after editing');
    });

    it('reports an already applied key as it now stands without writing it again (Req 16.11)', async () => {
      const page = await kit.createPage('applied-before');
      const left = await kit.createPage('applied-before-left');
      const proposal = await pendingProposal([
        kit.editInput(page),
        kit.editInput(left),
      ]);
      const [appliedKey] = keysOf(proposal);
      await service.approve(proposal._id, actor(users.requester), [appliedKey]);

      const result = await service.approve(
        proposal._id,
        actor(users.subscriber),
        [appliedKey],
      );

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [{ key: appliedKey, status: 'applied' }],
        },
      });
      expect(await kit.markedRevisions(proposal._id, appliedKey)).toHaveLength(
        1,
      );
      expect(
        kit.operationOf(await kit.reload(proposal._id), appliedKey).approvedBy,
      ).toBe(users.requester._id.toString());
      expect(await resultNotifications(proposal._id)).toEqual([]);
    });

    it('keeps the approval for the run holding the lease and answers the visible operations as they stand (Req 16.5)', async () => {
      const page = await kit.createPage('leased');
      const hidden = await ownedPage('leased-hidden', users.requester);
      const proposal = await pendingProposal([
        kit.editInput(page),
        kit.editInput(hidden),
      ]);
      const [key] = keysOf(proposal);
      const token = 'cp-reviewer-approve-held-lease';
      expect(
        await prisma.changeproposals.claimApplyLease(
          proposal._id,
          token,
          new Date(),
        ),
      ).toBe(true);

      try {
        const result = await service.approve(
          proposal._id,
          actor(users.subscriber),
        );

        expect(result).toEqual({
          ok: true,
          value: {
            type: 'in-progress',
            results: [{ key, status: 'pending' }],
          },
        });
        expect(
          kit.operationOf(await kit.reload(proposal._id), key),
        ).toMatchObject({
          status: 'pending',
          approvedBy: users.subscriber._id.toString(),
        });
      } finally {
        await prisma.changeproposals.releaseApplyLease(proposal._id, token);
      }
    });
  });

  describe('the requester', () => {
    it('leaves pending, rather than fails, an operation on a page they can no longer see (Req 16.1)', async () => {
      const shared = await kit.createPage('requester-kept');
      const lost = await ownedPage('requester-lost', users.other);
      const proposal = await pendingProposal(
        [kit.editInput(shared), kit.editInput(lost)],
        [],
      );
      const [sharedKey, lostKey] = keysOf(proposal);

      const result = await service.approve(
        proposal._id,
        actor(users.requester),
      );

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [{ key: sharedKey, status: 'applied' }],
        },
      });
      const lostOp = kit.operationOf(await kit.reload(proposal._id), lostKey);
      expect([lostOp.status, lostOp.approvedAt]).toEqual([
        'pending',
        undefined,
      ]);
    });
  });
});
