import { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';

import { MAX_REVIEWERS } from '../../interfaces';
import { createReviewerRoutesTestKit } from './reviewer-routes.test-kit';

// Stands for any reviewer in a body that is refused before the reviewer is looked at.
const SOMEONE = { kind: 'user', id: '0'.repeat(24) };

describe('change-proposal reviewer routes', () => {
  const {
    users,
    fixtures,
    asUser,
    idOf,
    endpointOf,
    patchReviewers,
    bearer,
    onlyActivityAt,
    expectNoActivityAt,
    expectOneUnsettledAttempt,
    userInput,
    reviewedProposal,
    requesterOnlyPage,
    settledReviewedProposal,
    activeReviewerIdsOf,
    setReviewersEnabled,
  } = createReviewerRoutesTestKit({
    loadCrowi: getInstance,
    prefix: '/cp-reviewers-route-integ',
    ip: '10.0.0.193',
    usernameBase: 'cpReviewersRoute',
  });

  describe('PATCH /:id/reviewers', () => {
    it('adds the reviewers with 204, and the activity keeps the one who added them (Reviewers Req 4.1, 6.10)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.subscriber);

      const res = await patchReviewers(proposal._id, {
        add: [userInput(fixtures.addedUser)],
      });

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(await activeReviewerIdsOf(proposal._id)).toEqual(
        [idOf(users.subscriber), idOf(fixtures.addedUser)].sort(),
      );
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviewers'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD,
        target: proposal._id,
        userId: idOf(users.subscriber),
      });
      expect(row.snapshot).toMatchObject({
        username: users.subscriber.username,
        reviewChannel: 'ui',
      });
    });

    it('removes the reviewers with 204, and the activity keeps the one who removed them (Reviewers Req 4.3, 6.10)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.requester);

      const res = await patchReviewers(proposal._id, {
        remove: [userInput(users.subscriber)],
      });

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviewers'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_REMOVE,
        target: proposal._id,
        userId: idOf(users.requester),
      });
      expect(row.snapshot).toMatchObject({
        username: users.requester.username,
        reviewChannel: 'ui',
      });
    });

    it('marks an addition and a removal sent with an access token as coming from the API (Reviewers Req 6.10)', async () => {
      const added = await reviewedProposal();
      const removed = await reviewedProposal();

      const readScope = await patchReviewers(added._id, {
        add: [userInput(fixtures.addedUser)],
      }).set('Authorization', bearer(fixtures.reviewerReadToken));
      const addition = await patchReviewers(added._id, {
        add: [userInput(fixtures.addedUser)],
      }).set('Authorization', bearer(fixtures.reviewerWriteToken));
      const removal = await patchReviewers(removed._id, {
        remove: [userInput(users.subscriber)],
      }).set('Authorization', bearer(fixtures.reviewerWriteToken));

      expect([readScope.status, addition.status, removal.status]).toEqual([
        403, 204, 204,
      ]);
      const rows = [
        await onlyActivityAt(endpointOf(added._id, 'reviewers')),
        await onlyActivityAt(endpointOf(removed._id, 'reviewers')),
      ];
      expect(
        rows.map((row) => [row.action, row.snapshot?.reviewChannel]),
      ).toEqual([
        [SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD, 'api'],
        [SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_REMOVE, 'api'],
      ]);
    });

    it.each([
      ['both add and remove', { add: [SOMEONE], remove: [SOMEONE] }],
      ['neither add nor remove', {}],
      ['an empty add', { add: [] }],
      ['an empty remove', { remove: [] }],
      ['a null add', { add: null }],
      ['a null remove beside an add', { add: [SOMEONE], remove: null }],
      ['a non-array add', { add: SOMEONE }],
      ['a reviewer of an unknown kind', { add: [{ ...SOMEONE, kind: 'all' }] }],
      [
        'a reviewer kind wrapped in an array',
        { remove: [{ ...SOMEONE, kind: ['user'] }] },
      ],
      ['a reviewer without an id', { add: [{ kind: 'user' }] }],
      ['a numeric reviewer id', { add: [{ ...SOMEONE, id: 1 }] }],
      [
        'an operator object as a reviewer id',
        { remove: [{ ...SOMEONE, id: { $ne: null } }] },
      ],
      ['a null reviewer', { add: [null] }],
    ])('answers %s with 400 validation_failed and changes nothing', async (_label, body) => {
      const proposal = await reviewedProposal();
      asUser(users.requester);

      const res = await patchReviewers(proposal._id, body);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('validation_failed');
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
      await expectOneUnsettledAttempt(endpointOf(proposal._id, 'reviewers'));
    });

    it('answers an addition it cannot store with 400 and the reason (Reviewers Req 4.5, 4.9)', async () => {
      const proposal = await reviewedProposal();
      const unknownUser = { kind: 'user', id: new Types.ObjectId().toString() };
      const tooMany = Array.from({ length: MAX_REVIEWERS }, () => ({
        kind: 'user',
        id: new Types.ObjectId().toString(),
      }));
      asUser(users.requester);

      const notFound = await patchReviewers(proposal._id, {
        add: [unknownUser],
      });
      const malformedId = await patchReviewers(proposal._id, {
        add: [{ kind: 'user', id: 'not-an-object-id' }],
      });
      const overLimit = await patchReviewers(proposal._id, { add: tooMany });
      await setReviewersEnabled(false);
      const disabled = await patchReviewers(proposal._id, {
        add: [userInput(fixtures.addedUser)],
      });

      expect(
        [notFound, malformedId, overLimit, disabled].map((res) => [
          res.status,
          res.body.errors[0].code,
        ]),
      ).toEqual([
        [400, 'reviewer_not_found'],
        [400, 'reviewer_not_found'],
        [400, 'too_many_reviewers'],
        [400, 'reviewers_disabled'],
      ]);
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
    });

    it('answers a missing proposal, a stranger and a reviewer who sees none of its pages with one identical 404 (Reviewers Req 2.7)', async () => {
      const proposal = await reviewedProposal();
      const hidden = await reviewedProposal([
        await requesterOnlyPage('hidden'),
      ]);
      const body = { add: [userInput(fixtures.addedUser)] };

      asUser(users.subscriber);
      const missing = await patchReviewers(
        new Types.ObjectId().toString(),
        body,
      );
      const nothingVisible = await patchReviewers(hidden._id, body);
      asUser(users.other);
      const stranger = await patchReviewers(proposal._id, body);

      for (const res of [missing, nothingVisible, stranger]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(missing.body);
      }
      expect(missing.body.errors[0].code).toBe('notfound');
      expect(await activeReviewerIdsOf(hidden._id)).toEqual([
        idOf(users.subscriber),
      ]);
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
    });

    it('answers a proposal that is no longer open with 409 not_open (Reviewers Req 4.8)', async () => {
      const proposal = await settledReviewedProposal();
      asUser(users.requester);

      const res = await patchReviewers(proposal._id, {
        remove: [userInput(users.subscriber)],
      });

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('not_open');
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
    });

    it('refuses a read-only requester and a guest without recording an activity (Reviewers Req 7.5)', async () => {
      const proposal = await reviewedProposal(undefined, {
        requester: idOf(fixtures.readOnlyUser),
      });
      const body = { remove: [userInput(users.subscriber)] };

      const guest = await patchReviewers(proposal._id, body);
      asUser(fixtures.readOnlyUser);
      const readOnly = await patchReviewers(proposal._id, body);

      expect(guest.status).toBe(403);
      expect(readOnly.status).toBe(400);
      expect(readOnly.body.errors[0].code).toBe('validation_failed');
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
      await expectNoActivityAt(endpointOf(proposal._id, 'reviewers'));
    });
  });
});
