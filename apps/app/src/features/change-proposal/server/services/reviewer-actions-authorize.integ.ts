import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument, ReviewerRef } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import { selectDecisionTargets } from './decision-targets';
import { createApplierTestKit } from './proposal-applier.test-kit';
import {
  authorizeReviewerAction,
  type ReviewerActionName,
} from './reviewer-actions';

const PREFIX = '/cp-reviewer-actions-authorize-integ';
const READ_ONLY_USERNAME = 'cpAuthorizeReadOnly';
const NOT_FOUND = { ok: false, error: { code: 'not-found' } };

const ALL_ACTIONS: readonly ReviewerActionName[] = [
  'approve',
  'rejectOperations',
  'rejectAll',
  'abstain',
  'addReviewers',
  'removeReviewers',
];
const REVIEW_ACTIONS: readonly ReviewerActionName[] = [
  'rejectOperations',
  'rejectAll',
  'abstain',
];
const REQUESTER_ACTIONS: readonly ReviewerActionName[] = [
  'approve',
  'addReviewers',
  'removeReviewers',
];

describe('authorizeReviewerAction', () => {
  let crowi: Crowi;
  let readOnlyUser: HydratedDocument<IUserHasId>;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: '10.0.0.172',
    usernames: {
      requester: 'cpAuthorizeRequester',
      subscriber: 'cpAuthorizeReviewer',
      other: 'cpAuthorizeOther',
    },
  });
  const { users } = kit;

  const authorize = (
    proposalId: string,
    user: IUserHasId,
    action: ReviewerActionName,
  ) =>
    authorizeReviewerAction(
      proposalId,
      { user, channel: 'ui', trigger: { kind: 'background' } },
      action,
    );

  const userReviewer = (user: IUserHasId): ReviewerRef => ({
    kind: 'user',
    id: user._id.toString(),
    addedBy: users.requester._id.toString(),
    addedAt: new Date(),
  });

  const keyOf = (proposal: ChangeProposalDocument, index: number): string => {
    const op = proposal.operations.find((o) => o.index === index);
    if (op == null) throw new Error(`operation ${index} not found`);
    return op.key;
  };

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

  const pendingProposal = (
    operations: readonly CreateOperationInput[],
    reviewers: readonly ReviewerRef[],
  ) => kit.storeProposal(operations, { approve: false, reviewers });

  const discard = (proposal: ChangeProposalDocument) =>
    prisma.changeproposals.skipPendingOperations(
      proposal._id,
      proposal.requester,
      'all-pending',
      'discarded',
    );

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    readOnlyUser = await mongoose.model<IUserHasId>('User').create({
      name: READ_ONLY_USERNAME,
      username: READ_ONLY_USERNAME,
      email: `${READ_ONLY_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
      readOnly: true,
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
    await mongoose.model('User').deleteMany({ _id: readOnlyUser._id });
    await kit.tearDown();
  });

  describe('callers who may not learn the proposal exists', () => {
    let missingId: string;
    let seen: ChangeProposalDocument;
    let unseen: ChangeProposalDocument;
    let seenClosed: ChangeProposalDocument;
    let unseenClosed: ChangeProposalDocument;

    beforeAll(async () => {
      vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
      missingId = new mongoose.Types.ObjectId().toString();
      const shared = await kit.createPage('shared');
      const hidden = await ownedPage('hidden', users.requester);
      const reviewers = [userReviewer(users.subscriber)];
      seen = await pendingProposal([kit.editInput(shared)], reviewers);
      unseen = await pendingProposal([kit.editInput(hidden)], reviewers);
      seenClosed = await pendingProposal([kit.editInput(shared)], reviewers);
      unseenClosed = await pendingProposal([kit.editInput(hidden)], reviewers);
      await discard(seenClosed);
      await discard(unseenClosed);
      vi.restoreAllMocks();
    });

    it.each(
      ALL_ACTIONS,
    )('get the same answer as for a missing proposal: %s (Reviewers Req 2.7, 3.11)', async (action) => {
      const answers = await Promise.all([
        authorize(missingId, users.subscriber, action),
        authorize('not-an-object-id', users.subscriber, action),
        authorize(seen._id, users.other, action),
        authorize(unseen._id, users.subscriber, action),
      ]);

      for (const answer of answers) {
        expect(answer).toEqual(NOT_FOUND);
      }
    });

    it.each(
      ALL_ACTIONS,
    )('are not told a proposal is closed: %s (Reviewers Req 2.7, 3.11)', async (action) => {
      // A reviewer who sees the closed proposal is told so; the others must not be.
      expect(await authorize(seenClosed._id, users.subscriber, action)).toEqual(
        { ok: false, error: { code: 'not-open' } },
      );

      expect(await authorize(seenClosed._id, users.other, action)).toEqual(
        NOT_FOUND,
      );
      expect(
        await authorize(unseenClosed._id, users.subscriber, action),
      ).toEqual(NOT_FOUND);
    });
  });

  describe('a reviewer', () => {
    it.each(
      ALL_ACTIONS,
    )('who sees a pending operation may go on with %s, given what they may decide (Reviewers Req 2.6)', async (action) => {
      const shared = await kit.createPage(`reviewer-${action}`);
      const hidden = await ownedPage(
        `reviewer-hidden-${action}`,
        users.requester,
      );
      const proposal = await pendingProposal(
        [kit.editInput(shared), kit.editInput(hidden)],
        [userReviewer(users.subscriber)],
      );

      const answer = await authorize(proposal._id, users.subscriber, action);

      if (!answer.ok) throw new Error(answer.error.code);
      expect(answer.value.role).toBe('reviewer');
      expect(answer.value.identity.userId).toBe(
        users.subscriber._id.toString(),
      );
      expect([...answer.value.scope.visibleKeys]).toEqual([keyOf(proposal, 0)]);
      expect([...answer.value.scope.reviewTargetKeys]).toEqual([
        keyOf(proposal, 0),
      ]);
    });

    it.each(
      ALL_ACTIONS,
    )('is told not-open once nothing they see is pending, though the proposal is still open: %s (Reviewers Req 2.11, 4.8)', async (action) => {
      const shared = await kit.createPage(`stage-${action}`);
      const hidden = await ownedPage(`stage-hidden-${action}`, users.requester);
      const proposal = await pendingProposal(
        [kit.editInput(shared), kit.editInput(hidden)],
        [userReviewer(users.subscriber)],
      );
      await prisma.changeproposals.skipPendingOperations(
        proposal._id,
        proposal.requester,
        [keyOf(proposal, 0)],
      );
      expect((await kit.reload(proposal._id)).lifecycle).toBe('open');

      expect(await authorize(proposal._id, users.subscriber, action)).toEqual({
        ok: false,
        error: { code: 'not-open' },
      });
    });

    it('cannot pull a hidden operation into a decision by naming its key (Reviewers Req 2.6)', async () => {
      const shared = await kit.createPage('keys-shared');
      const hidden = await ownedPage('keys-hidden', users.requester);
      const proposal = await pendingProposal(
        [kit.editInput(shared), kit.editInput(hidden)],
        [userReviewer(users.subscriber)],
      );

      const answer = await authorize(proposal._id, users.subscriber, 'approve');
      if (!answer.ok) throw new Error(answer.error.code);

      expect(
        selectDecisionTargets(
          answer.value.proposal.operations,
          answer.value.scope,
          [keyOf(proposal, 1), keyOf(proposal, 0)],
        ),
      ).toEqual({
        requestedKeys: [keyOf(proposal, 0)],
        targetKeys: [keyOf(proposal, 0)],
      });
    });
  });

  describe('the requester', () => {
    it.each(
      REVIEW_ACTIONS,
    )('may not %s, even when listed as a reviewer (Reviewers Req 3.10)', async (action) => {
      const shared = await kit.createPage(`requester-review-${action}`);
      const proposal = await pendingProposal(
        [kit.editInput(shared)],
        [userReviewer(users.requester), userReviewer(users.subscriber)],
      );

      expect(await authorize(proposal._id, users.requester, action)).toEqual({
        ok: false,
        error: { code: 'requester-cannot-review' },
      });
    });

    it.each(
      REQUESTER_ACTIONS,
    )('may go on with %s without being a reviewer (Reviewers Req 2.3, 4.1, 4.3)', async (action) => {
      const shared = await kit.createPage(`requester-act-${action}`);
      const proposal = await pendingProposal(
        [kit.editInput(shared)],
        [userReviewer(users.subscriber)],
      );

      const answer = await authorize(proposal._id, users.requester, action);

      if (!answer.ok) throw new Error(answer.error.code);
      expect(answer.value.role).toBe('requester');
      expect([...answer.value.scope.reviewTargetKeys]).toEqual([
        keyOf(proposal, 0),
      ]);
    });

    it('is judged by the actual stage, so an open proposal with nothing they still see is not closed to them (Reviewers Req 2.9)', async () => {
      const lost = await ownedPage('requester-lost', users.other);
      const proposal = await pendingProposal([kit.editInput(lost)], []);

      const whileOpen = await authorize(
        proposal._id,
        users.requester,
        'approve',
      );
      if (!whileOpen.ok) throw new Error(whileOpen.error.code);
      expect(whileOpen.value.scope.reviewTargetKeys.size).toBe(0);

      await discard(proposal);
      expect(await authorize(proposal._id, users.requester, 'approve')).toEqual(
        { ok: false, error: { code: 'not-open' } },
      );
    });
  });

  describe('a read-only user', () => {
    it.each(
      ALL_ACTIONS,
    )('is refused %s even as a reviewer, whether or not the proposal exists (Reviewers Req 7.5)', async (action) => {
      const shared = await kit.createPage(`read-only-${action}`);
      const proposal = await pendingProposal(
        [kit.editInput(shared)],
        [userReviewer(readOnlyUser)],
      );
      const refused = { ok: false, error: { code: 'user-not-allowed' } };

      expect(await authorize(proposal._id, readOnlyUser, action)).toEqual(
        refused,
      );
      expect(
        await authorize(
          new mongoose.Types.ObjectId().toString(),
          readOnlyUser,
          action,
        ),
      ).toEqual(refused);
    });
  });
});
