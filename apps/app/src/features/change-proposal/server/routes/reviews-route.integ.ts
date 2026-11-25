import { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';

import { MAX_REVIEW_COMMENT_LENGTH } from '../../interfaces';
import { createReviewerRoutesTestKit } from './reviewer-routes.test-kit';
import { MAX_OPERATION_KEYS } from './write-access';

describe('change-proposal reviewer routes', () => {
  const {
    kit,
    users,
    fixtures,
    asUser,
    idOf,
    endpointOf,
    postReview,
    bearer,
    onlyActivityAt,
    expectNoActivityAt,
    expectOneUnsettledAttempt,
    userInput,
    storedRef,
    reviewedProposal,
    requesterOnlyPage,
    settledReviewedProposal,
  } = createReviewerRoutesTestKit({
    loadCrowi: getInstance,
    prefix: '/cp-reviews-route-integ',
    ip: '10.0.0.192',
    usernameBase: 'cpReviewsRoute',
  });

  describe('POST /:id/reviews', () => {
    it('records a rejection of the chosen operation without changing its state, and the activity keeps the reviewer (Req 17.1, 20.8)', async () => {
      const proposal = await reviewedProposal();
      const [op] = proposal.operations;
      asUser(users.subscriber);

      const res = await postReview(proposal._id, {
        kind: 'reject',
        operationKeys: [op.key],
        comment: 'please split this change',
      });

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({
        type: 'done',
        results: [{ key: op.key, status: 'pending', reason: null }],
      });
      expect((await kit.reload(proposal._id)).reviews).toEqual([
        expect.objectContaining({
          kind: 'reject',
          operationKey: op.key,
          by: idOf(users.subscriber),
          comment: 'please split this change',
          channel: 'ui',
        }),
      ]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviews'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
        target: proposal._id,
        userId: idOf(users.subscriber),
      });
      expect(row.snapshot).toMatchObject({
        username: users.subscriber.username,
        reviewChannel: 'ui',
      });
    });

    it('records a rejection of the whole proposal when no keys are given, treating an empty comment as none (Req 17.2)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.subscriber);

      const res = await postReview(proposal._id, {
        kind: 'reject',
        comment: '',
      });

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({ type: 'done', results: [] });
      const [review, ...rest] = (await kit.reload(proposal._id)).reviews;
      expect(rest).toEqual([]);
      expect(review).toMatchObject({
        kind: 'reject',
        by: idOf(users.subscriber),
      });
      expect([review.operationKey ?? null, review.comment ?? null]).toEqual([
        null,
        null,
      ]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviews'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
        userId: idOf(users.subscriber),
      });
    });

    it('records an abstention of the chosen operation, and the activity keeps the reviewer (Req 17.3, 20.8)', async () => {
      const proposal = await reviewedProposal();
      const [op] = proposal.operations;
      asUser(users.subscriber);

      const res = await postReview(proposal._id, {
        kind: 'abstain',
        operationKeys: [op.key],
      });

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({
        type: 'done',
        results: [{ key: op.key, status: 'pending', reason: null }],
      });
      expect((await kit.reload(proposal._id)).reviews).toEqual([
        expect.objectContaining({ kind: 'abstain', operationKey: op.key }),
      ]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviews'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_ABSTAIN,
        userId: idOf(users.subscriber),
      });
      expect(row.snapshot).toMatchObject({
        username: users.subscriber.username,
        reviewChannel: 'ui',
      });
    });

    it('marks a review sent with an access token as coming from the API (Req 20.8)', async () => {
      const proposal = await reviewedProposal();

      const readScope = await postReview(proposal._id, {
        kind: 'reject',
      }).set('Authorization', bearer(fixtures.reviewerReadToken));
      const writeScope = await postReview(proposal._id, {
        kind: 'abstain',
        operationKeys: [proposal.operations[0].key],
      }).set('Authorization', bearer(fixtures.reviewerWriteToken));

      expect(readScope.status).toBe(403);
      expect(writeScope.status).toBe(200);
      expect((await kit.reload(proposal._id)).reviews).toEqual([
        expect.objectContaining({ kind: 'abstain', channel: 'api' }),
      ]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviews'));
      expect(row.snapshot).toMatchObject({ reviewChannel: 'api' });
    });

    it.each([
      [
        'a rejection with an empty key list',
        { kind: 'reject', operationKeys: [] },
      ],
      ['an abstention without keys', { kind: 'abstain' }],
      [
        'an abstention with an empty key list',
        { kind: 'abstain', operationKeys: [] },
      ],
      ['a non-array key list', { kind: 'reject', operationKeys: 'key' }],
      ['a null key list', { kind: 'reject', operationKeys: null }],
      ['a non-string key', { kind: 'reject', operationKeys: [{ $ne: null }] }],
      [
        'more keys than one request may carry',
        {
          kind: 'reject',
          operationKeys: Array.from(
            { length: MAX_OPERATION_KEYS + 1 },
            (_, i) => `k${i}`,
          ),
        },
      ],
      [
        'an operator object as the key list',
        { kind: 'abstain', operationKeys: { $ne: null } },
      ],
      ['an empty key', { kind: 'reject', operationKeys: [''] }],
      ['a non-string comment', { kind: 'reject', comment: { $ne: null } }],
      ['a null comment', { kind: 'reject', comment: null }],
      ['an unknown kind', { kind: 'approve' }],
      ['a kind wrapped in an array', { kind: ['reject'] }],
      ['an operator object as the kind', { kind: { $ne: null } }],
      ['no kind', {}],
    ])('answers %s with 400 validation_failed and records nothing but the attempt', async (_label, body) => {
      const proposal = await reviewedProposal();
      asUser(users.subscriber);

      const res = await postReview(proposal._id, body);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('validation_failed');
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
      await expectOneUnsettledAttempt(endpointOf(proposal._id, 'reviews'));
    });

    it.each([
      ['abstain'],
      ['reject'],
    ])('refuses the whole-proposal marker sent as the key list of a %s and keeps the whole rejection recorded earlier', async (kind) => {
      const proposal = await reviewedProposal();
      asUser(users.subscriber);
      const earlier = await postReview(proposal._id, {
        kind: 'reject',
        comment: 'rejected as a whole',
      });
      const before = (await kit.reload(proposal._id)).reviews;

      const res = await postReview(proposal._id, {
        kind,
        operationKeys: 'whole-proposal',
      });

      expect(earlier.status).toBe(200);
      expect(before).toEqual([
        expect.objectContaining({
          kind: 'reject',
          by: idOf(users.subscriber),
          comment: 'rejected as a whole',
        }),
      ]);
      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('validation_failed');
      expect((await kit.reload(proposal._id)).reviews).toEqual(before);
    });

    it('answers a comment over the limit with 400 comment_too_long (Req 17.6)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.subscriber);

      const res = await postReview(proposal._id, {
        kind: 'reject',
        comment: 'x'.repeat(MAX_REVIEW_COMMENT_LENGTH + 1),
      });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('comment_too_long');
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
    });

    it('answers the requester with 400 requester_cannot_review (Req 17.10)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.requester);

      const responses = [
        await postReview(proposal._id, { kind: 'reject' }),
        await postReview(proposal._id, {
          kind: 'abstain',
          operationKeys: [proposal.operations[0].key],
        }),
      ];

      for (const res of responses) {
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('requester_cannot_review');
      }
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
    });

    it('answers a missing proposal, a stranger and a reviewer who sees none of its pages with one identical 404 (Req 16.7, 17.11)', async () => {
      const proposal = await reviewedProposal();
      const hidden = await reviewedProposal([
        await requesterOnlyPage('hidden'),
      ]);
      const body = { kind: 'reject' };

      asUser(users.subscriber);
      const missing = await postReview(new Types.ObjectId().toString(), body);
      const nothingVisible = await postReview(hidden._id, body);
      asUser(users.other);
      const stranger = await postReview(proposal._id, body);

      for (const res of [missing, nothingVisible, stranger]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(missing.body);
      }
      expect(missing.body.errors[0].code).toBe('notfound');
      expect((await kit.reload(hidden._id)).reviews).toEqual([]);
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
    });

    it('answers a reviewer with nothing left to decide with 409 not_open (Req 16.9)', async () => {
      const proposal = await settledReviewedProposal();
      asUser(users.subscriber);

      const res = await postReview(proposal._id, { kind: 'reject' });

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('not_open');
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
    });

    it('refuses a read-only reviewer and a guest without recording an activity (Req 21.5)', async () => {
      const proposal = await kit.storeProposal(
        [kit.editInput(await kit.createPage('read-only'))],
        {
          approve: false,
          reviewers: [storedRef(userInput(fixtures.readOnlyUser))],
        },
      );
      const body = { kind: 'reject' };

      const guest = await postReview(proposal._id, body);
      asUser(fixtures.readOnlyUser);
      const readOnly = await postReview(proposal._id, body);

      expect(guest.status).toBe(403);
      expect(readOnly.status).toBe(400);
      expect(readOnly.body.errors[0].code).toBe('validation_failed');
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
      await expectNoActivityAt(endpointOf(proposal._id, 'reviews'));
    });
  });
});
