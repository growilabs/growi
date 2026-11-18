import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { Prisma } from '~/generated/prisma/client';
import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import { UserStatus } from '~/server/models/user/conts';
import { prisma } from '~/utils/prisma';

import {
  type ChangeProposalDocument,
  type ChangeProposalView,
  MAX_REVIEW_COMMENT_LENGTH,
  type OperationView,
  type ReviewerRef,
  type ReviewResultNotificationSnapshot,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { ServiceResult } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';
import type { ReviewActor } from './reviewer-actions';
import { loadViewerIdentity } from './reviewer-identity';

const PREFIX = '/cp-reviewer-reviews-integ';
const SUSPENDED_USERNAME = 'cpReviewsSuspended';
const BACKGROUND = { kind: 'background' } as const;
const RAW_COMMENT = '<script>alert("x")</script> **as typed** & <b>';
const NOT_FOUND = { ok: false, error: { code: 'not-found' } };

describe('ChangeProposalService: rejecting and abstaining', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let suspendedUser: HydratedDocument<IUserHasId>;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: '10.0.0.163',
    usernames: {
      requester: 'cpReviewsRequester',
      subscriber: 'cpReviewsReviewer',
      other: 'cpReviewsOther',
    },
  });
  const { users } = kit;

  const actor = (user: IUserHasId): ReviewActor => ({
    user,
    channel: 'ui',
    trigger: BACKGROUND,
  });

  const idOf = (user: IUserHasId): string => user._id.toString();

  const userReviewer = (user: IUserHasId): ReviewerRef => ({
    kind: 'user',
    id: idOf(user),
    addedBy: idOf(users.requester),
    addedAt: new Date(),
  });

  const pendingProposal = (
    operations: readonly CreateOperationInput[],
    reviewers: readonly ReviewerRef[] = [userReviewer(users.subscriber)],
  ) => kit.storeProposal(operations, { approve: false, reviewers });

  const keysOf = (proposal: ChangeProposalDocument): string[] =>
    proposal.operations.map((op) => op.key);

  // Viewable by the requester alone, so hidden from every reviewer.
  const requesterOnlyPage = async (label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.requester,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const viewOf = (result: ServiceResult<ChangeProposalView>) => {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const opOf = (view: ChangeProposalView, key: string): OperationView => {
    const op = view.operations.find((o) => o.key === key);
    if (op == null) throw new Error(`operation ${key} not in the view`);
    return op;
  };

  // [operationKey, kind] of every stored record; '' is a whole rejection.
  const recordsOf = async (proposalId: string) =>
    (await kit.reload(proposalId)).reviews.map((r) => [
      r.operationKey ?? '',
      r.kind,
    ]);

  const resultNotifications = (proposalId: string) =>
    InAppNotification.find({
      target: proposalId,
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_RESULT,
    })
      .lean()
      .exec();

  const snapshotsOf = async (
    proposalId: string,
  ): Promise<ReviewResultNotificationSnapshot[]> =>
    (await resultNotifications(proposalId)).map((n) => JSON.parse(n.snapshot));

  const activitiesOf = (proposalId: string) =>
    prisma.activities.findMany({ where: { target: proposalId } });

  // Activities settle asynchronously: wait for the expected count, then for any stray one.
  const settledActivitiesOf = async (proposalId: string, count: number) => {
    await vi.waitFor(
      async () => {
        const rows = await activitiesOf(proposalId);
        if (rows.length < count) {
          throw new Error(`${rows.length} activities for ${proposalId}`);
        }
      },
      { timeout: 5000, interval: 50 },
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    return activitiesOf(proposalId);
  };

  const noActivityAfterAWhile = async (proposalId: string) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    expect(await activitiesOf(proposalId)).toEqual([]);
  };

  // Restoring a spy on a Prisma model method leaves the method undefined, so
  // the spy stays installed and calls the bound original unless a test overrides it.
  const spyOnUpdateMany = () => {
    const original = prisma.changeproposals.updateMany.bind(
      prisma.changeproposals,
    );
    return {
      original,
      spy: vi.spyOn(prisma.changeproposals, 'updateMany'),
    };
  };
  let updateMany: ReturnType<typeof spyOnUpdateMany>;
  let emitSpy: { mockRestore(): void } | undefined;

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    suspendedUser = await mongoose.model<IUserHasId>('User').create({
      name: SUSPENDED_USERNAME,
      username: SUSPENDED_USERNAME,
      email: `${SUSPENDED_USERNAME}@example.com`,
      status: UserStatus.STATUS_SUSPENDED,
    });
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
    updateMany = spyOnUpdateMany();
  });

  beforeEach(() => {
    updateMany.spy.mockReset().mockImplementation(updateMany.original);
    // Page events have async listeners (search, vault) unrelated to this test.
    emitSpy = vi
      .spyOn(crowi.pageService.pageEvent, 'emit')
      .mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    emitSpy?.mockRestore();
  });

  afterAll(async () => {
    await mongoose.model('User').deleteMany({ _id: suspendedUser._id });
    await kit.tearDown();
  });

  describe('a rejection of operations', () => {
    it('records who rejected, when, from where and the comment as typed, and changes neither the operations nor the stage (Reviewers Req 3.1, 3.5, 3.9)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('reject-a')),
        kit.editInput(await kit.createPage('reject-b')),
      ]);
      const [rejected, untouched] = keysOf(proposal);
      const requesterViewBefore = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );

      const result = await service.rejectOperations(
        proposal._id,
        { ...actor(users.subscriber), channel: 'api' },
        [rejected],
        RAW_COMMENT,
      );

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [{ key: rejected, status: 'pending', reason: null }],
        },
      });
      const stored = await kit.reload(proposal._id);
      expect(stored.reviews).toEqual([
        {
          kind: 'reject',
          operationKey: rejected,
          by: idOf(users.subscriber),
          at: expect.any(Date),
          comment: RAW_COMMENT,
          channel: 'api',
        },
      ]);
      expect(stored.lifecycle).toBe('open');
      for (const key of [rejected, untouched]) {
        const op = kit.operationOf(stored, key);
        expect([op.status, op.approvedAt]).toEqual(['pending', undefined]);
      }
      const requesterViewAfter = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );
      expect([
        requesterViewAfter.status,
        requesterViewAfter.requesterState,
      ]).toEqual([
        requesterViewBefore.status,
        requesterViewBefore.requesterState,
      ]);
    });

    it('lets the reviewer read their own record back, comment as typed (Reviewers Req 3.7, 3.8)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('read-back')),
      ]);
      const [key] = keysOf(proposal);

      await service.rejectOperations(
        proposal._id,
        actor(users.subscriber),
        [key],
        RAW_COMMENT,
      );

      const view = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );
      expect(opOf(view, key).rejections).toEqual([
        expect.objectContaining({
          by: expect.objectContaining({ id: idOf(users.subscriber) }),
          comment: RAW_COMMENT,
        }),
      ]);
    });

    it('still lets another reviewer or the requester approve what was rejected, and applies it (Reviewers Req 3.9)', async () => {
      const byOther = await kit.createPage('approved-by-other');
      const byRequester = await kit.createPage('approved-by-requester');
      const proposal = await pendingProposal(
        [
          kit.editInput(byOther, 'body by other'),
          kit.editInput(byRequester, 'body by requester'),
        ],
        [userReviewer(users.subscriber), userReviewer(users.other)],
      );
      const [otherKey, requesterKey] = keysOf(proposal);
      await service.rejectOperations(proposal._id, actor(users.subscriber), [
        otherKey,
        requesterKey,
      ]);
      await service.rejectAll(proposal._id, actor(users.subscriber));

      await service.approve(proposal._id, actor(users.other), [otherKey]);
      await service.approve(proposal._id, actor(users.requester), [
        requesterKey,
      ]);

      const stored = await kit.reload(proposal._id);
      expect(kit.operationOf(stored, otherKey).status).toBe('applied');
      expect(kit.operationOf(stored, requesterKey).status).toBe('applied');
    });
  });

  describe('an abstention', () => {
    it('is recorded as an abstention, and the operation stays the reviewer’s to approve (Reviewers Req 3.3)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('abstain')),
      ]);
      const [key] = keysOf(proposal);

      const result = await service.abstain(
        proposal._id,
        actor(users.subscriber),
        [key],
        'not my area',
      );

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [{ key, status: 'pending', reason: null }],
        },
      });
      expect((await kit.reload(proposal._id)).reviews).toEqual([
        expect.objectContaining({
          kind: 'abstain',
          operationKey: key,
          comment: 'not my area',
        }),
      ]);
      await service.approve(proposal._id, actor(users.subscriber), [key]);
      expect(kit.operationOf(await kit.reload(proposal._id), key).status).toBe(
        'applied',
      );
    });

    it('replaces the same reviewer’s earlier rejection of the operation (Reviewers Req 3.4)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('replaced')),
      ]);
      const [key] = keysOf(proposal);
      await service.rejectOperations(
        proposal._id,
        actor(users.subscriber),
        [key],
        'first',
      );

      await service.abstain(
        proposal._id,
        actor(users.subscriber),
        [key],
        'second',
      );

      expect((await kit.reload(proposal._id)).reviews).toEqual([
        expect.objectContaining({
          kind: 'abstain',
          operationKey: key,
          comment: 'second',
        }),
      ]);
    });
  });

  describe('a rejection of the whole proposal', () => {
    it('adds one record with no operation, writes nothing on any operation and answers no operation (Reviewers Req 3.2, 3.9)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('whole-visible')),
        kit.editInput(await requesterOnlyPage('whole-hidden')),
      ]);

      const result = await service.rejectAll(
        proposal._id,
        actor(users.subscriber),
        RAW_COMMENT,
      );

      expect(result).toEqual({
        ok: true,
        value: { type: 'done', results: [] },
      });
      const stored = await kit.reload(proposal._id);
      expect(stored.reviews).toEqual([
        {
          kind: 'reject',
          by: idOf(users.subscriber),
          at: expect.any(Date),
          comment: RAW_COMMENT,
          channel: 'ui',
        },
      ]);
      expect(stored.lifecycle).toBe('open');
      expect(stored.operations.map((op) => [op.status, op.approvedAt])).toEqual(
        [
          ['pending', undefined],
          ['pending', undefined],
        ],
      );
    });

    it('is returned to the requester and never to the reviewer who made it (Reviewers Req 3.8)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('whole-read')),
      ]);

      await service.rejectAll(
        proposal._id,
        actor(users.subscriber),
        RAW_COMMENT,
      );

      const requesterView = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );
      expect(requesterView.wholeRejections).toEqual([
        expect.objectContaining({
          by: expect.objectContaining({ id: idOf(users.subscriber) }),
          comment: RAW_COMMENT,
        }),
      ]);
      const reviewerView = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );
      expect(reviewerView).not.toHaveProperty('wholeRejections');
    });

    it('notifies the requester although it names no operation (Reviewers Req 6.5)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('whole-notified')),
      ]);

      await service.rejectAll(proposal._id, actor(users.subscriber), 'no');

      const notifications = await resultNotifications(proposal._id);
      expect(notifications.map((n) => n.user.toString())).toEqual([
        idOf(users.requester),
      ]);
      expect(await snapshotsOf(proposal._id)).toEqual([
        expect.objectContaining({
          items: [],
          wholeRejection: { comment: 'no' },
        }),
      ]);
    });
  });

  describe('the comment length', () => {
    it('counts code points, so the limit in emoji is accepted (Reviewers Req 3.6)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('emoji-limit')),
      ]);
      const [key] = keysOf(proposal);
      const atLimit = '😀'.repeat(MAX_REVIEW_COMMENT_LENGTH);

      const result = await service.rejectOperations(
        proposal._id,
        actor(users.subscriber),
        [key],
        atLimit,
      );

      expect(result.ok).toBe(true);
      expect((await kit.reload(proposal._id)).reviews).toEqual([
        expect.objectContaining({ comment: atLimit }),
      ]);
    });

    it('refuses one code point over the limit and records and sends nothing (Reviewers Req 3.6)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('too-long')),
      ]);
      const [key] = keysOf(proposal);
      const overLimit = `${'😀'.repeat(MAX_REVIEW_COMMENT_LENGTH)}a`;
      const refused = { ok: false, error: { code: 'comment-too-long' } };

      expect(
        await service.rejectOperations(
          proposal._id,
          actor(users.subscriber),
          [key],
          overLimit,
        ),
      ).toEqual(refused);
      expect(
        await service.abstain(
          proposal._id,
          actor(users.subscriber),
          [key],
          overLimit,
        ),
      ).toEqual(refused);
      expect(
        await service.rejectAll(
          proposal._id,
          actor(users.subscriber),
          overLimit,
        ),
      ).toEqual(refused);

      expect(await recordsOf(proposal._id)).toEqual([]);
      expect(await resultNotifications(proposal._id)).toEqual([]);
      await noActivityAfterAWhile(proposal._id);
    });

    it('gives a stranger and a missing proposal the same answer, so it tells nothing about the proposal (Reviewers Req 2.7, 3.11)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('too-long-stranger')),
      ]);
      const overLimit = 'a'.repeat(MAX_REVIEW_COMMENT_LENGTH + 1);
      const refused = { ok: false, error: { code: 'comment-too-long' } };

      expect(
        await service.rejectAll(
          new mongoose.Types.ObjectId().toString(),
          actor(users.other),
          overLimit,
        ),
      ).toEqual(refused);
      expect(
        await service.rejectAll(proposal._id, actor(users.other), overLimit),
      ).toEqual(refused);
    });
  });

  describe('what the request records and reports', () => {
    it('records and notifies only the visible pending operations, never a hidden or already applied one it named (Reviewers Req 2.6, 2.11, 6.5)', async () => {
      const shared = await kit.createPage('report-shared');
      const hidden = await requesterOnlyPage('report-hidden');
      const done = await kit.createPage('report-done');
      const proposal = await pendingProposal([
        kit.editInput(shared),
        kit.editInput(hidden),
        kit.editInput(done),
      ]);
      const [sharedKey, hiddenKey, doneKey] = keysOf(proposal);
      await service.approve(proposal._id, actor(users.requester), [doneKey]);

      const result = await service.rejectOperations(
        proposal._id,
        actor(users.subscriber),
        [sharedKey, hiddenKey, doneKey],
        'reason',
      );

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [
            { key: sharedKey, status: 'pending', reason: null },
            { key: doneKey, status: 'applied', reason: null },
          ],
        },
      });
      expect(await recordsOf(proposal._id)).toEqual([[sharedKey, 'reject']]);
      expect(await snapshotsOf(proposal._id)).toEqual([
        expect.objectContaining({
          items: [{ path: shared.path, result: 'rejected', comment: 'reason' }],
        }),
      ]);
    });

    it('records the rejection as a reject activity and the abstention as an abstain activity, with the channel (Reviewers Req 6.8)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('activity-a')),
        kit.editInput(await kit.createPage('activity-b')),
      ]);
      const [first, second] = keysOf(proposal);

      await service.rejectOperations(
        proposal._id,
        { ...actor(users.subscriber), channel: 'api' },
        [first],
      );
      await service.abstain(
        proposal._id,
        { ...actor(users.subscriber), channel: 'ai-tool' },
        [second],
      );
      await service.rejectAll(proposal._id, actor(users.subscriber));

      const rows = await settledActivitiesOf(proposal._id, 3);
      expect(
        rows.map((row) => [
          row.action,
          row.userId,
          row.snapshot?.reviewChannel,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [
            SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
            idOf(users.subscriber),
            'api',
          ],
          [
            SupportedAction.ACTION_CHANGE_PROPOSAL_ABSTAIN,
            idOf(users.subscriber),
            'ai-tool',
          ],
          [
            SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
            idOf(users.subscriber),
            'ui',
          ],
        ]),
      );
      expect(rows).toHaveLength(3);
    });

    it('records, notifies and logs nothing when nothing it named is still pending (Reviewers Req 2.11, 6.5, 6.8)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('nothing-done')),
        kit.editInput(await kit.createPage('nothing-left')),
      ]);
      const [doneKey] = keysOf(proposal);
      await service.approve(proposal._id, actor(users.requester), [doneKey]);
      const before = await settledActivitiesOf(proposal._id, 2);

      const result = await service.abstain(
        proposal._id,
        actor(users.subscriber),
        [doneKey],
      );

      expect(result).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [{ key: doneKey, status: 'applied', reason: null }],
        },
      });
      expect(await recordsOf(proposal._id)).toEqual([]);
      expect(await resultNotifications(proposal._id)).toEqual([]);
      expect(await settledActivitiesOf(proposal._id, 2)).toHaveLength(
        before.length,
      );
    });

    it('records nothing for an empty list of operations, and never turns it into a whole rejection', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('empty-keys')),
      ]);

      const rejected = await service.rejectOperations(
        proposal._id,
        actor(users.subscriber),
        [],
      );
      const abstained = await service.abstain(
        proposal._id,
        actor(users.subscriber),
        [],
      );

      expect([rejected.ok, abstained.ok]).toEqual([true, true]);
      expect(await recordsOf(proposal._id)).toEqual([]);
    });
  });

  describe('a record the write could not store', () => {
    // What the query engine raises once it gave up retrying on write conflicts.
    const writeConflict = () =>
      new Prisma.PrismaClientKnownRequestError('Transaction failed', {
        code: 'P2034',
        clientVersion: 'test',
      });

    it('fails the request instead of answering it as recorded, keeps the earlier record and sends and logs nothing (Reviewers Req 3.4, 6.5, 6.8)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('conflict')),
      ]);
      const [key] = keysOf(proposal);
      await prisma.changeproposals.addReviews(
        proposal._id,
        await loadViewerIdentity(idOf(users.subscriber)),
        {
          kind: 'reject',
          target: { scope: 'operations', operationKeys: [key] },
          channel: 'ui',
        },
        new Date(),
      );
      updateMany.spy.mockRejectedValueOnce(writeConflict());

      await expect(
        service.abstain(proposal._id, actor(users.subscriber), [key]),
      ).rejects.toThrow('write conflicts');

      expect(await recordsOf(proposal._id)).toEqual([[key, 'reject']]);
      expect(await resultNotifications(proposal._id)).toEqual([]);
      await noActivityAfterAWhile(proposal._id);
    });

    it('fails a whole rejection the same way on any other failure', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('other-failure')),
      ]);
      updateMany.spy.mockRejectedValueOnce(new Error('connection lost'));

      await expect(
        service.rejectAll(proposal._id, actor(users.subscriber)),
      ).rejects.toThrow('connection lost');
      expect(await resultNotifications(proposal._id)).toEqual([]);
      await noActivityAfterAWhile(proposal._id);
    });
  });

  describe('who may not record a decision', () => {
    it('refuses the requester even on a closed proposal, before telling it is closed (Reviewers Req 3.10)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('requester-closed')),
      ]);
      await prisma.changeproposals.skipPendingOperations(
        proposal._id,
        proposal.requester,
        'all-pending',
        'discarded',
      );

      expect(
        await service.rejectAll(proposal._id, actor(users.requester)),
      ).toEqual({ ok: false, error: { code: 'requester-cannot-review' } });
    });

    it('answers someone neither the requester nor a reviewer as if the proposal did not exist, and records nothing (Reviewers Req 3.11)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('stranger')),
      ]);

      expect(await service.rejectAll(proposal._id, actor(users.other))).toEqual(
        NOT_FOUND,
      );
      expect(
        await service.abstain(
          proposal._id,
          actor(users.other),
          keysOf(proposal),
        ),
      ).toEqual(NOT_FOUND);
      expect(await recordsOf(proposal._id)).toEqual([]);
    });

    it('refuses a reviewer whose account is not active', async () => {
      const proposal = await pendingProposal(
        [kit.editInput(await kit.createPage('suspended'))],
        [userReviewer(suspendedUser)],
      );

      expect(
        await service.rejectAll(proposal._id, actor(suspendedUser)),
      ).toEqual({ ok: false, error: { code: 'user-not-allowed' } });
      expect(await recordsOf(proposal._id)).toEqual([]);
    });

    it('records an empty comment as no comment', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('empty-comment')),
      ]);

      await service.abstain(
        proposal._id,
        actor(users.subscriber),
        keysOf(proposal),
        '',
      );

      const { reviews } = await kit.reload(proposal._id);
      expect(reviews.length).toBeGreaterThan(0);
      expect(reviews.every((r) => r.comment == null)).toBe(true);
    });
  });
});
