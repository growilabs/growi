import { createReviewerRoutesTestKit } from './reviewer-routes.test-kit';

describe('change-proposal reviewer routes', () => {
  const {
    kit,
    users,
    fixtures,
    asUser,
    getQueue,
    bearer,
    userInput,
    storedRef,
    reviewedProposal,
    requesterOnlyPage,
  } = createReviewerRoutesTestKit({
    prefix: '/cp-review-queue-route-integ',
    ip: '10.0.0.194',
    usernameBase: 'cpReviewQueueRoute',
  });

  describe('GET /review-queue', () => {
    // Other tests leave open proposals in the reviewer's queue, so each test follows the cursor to its own.
    const queuedIdsFrom = async (cursor: string | null): Promise<string[]> => {
      const res = await getQueue(cursor == null ? {} : { cursor });
      expect(res.status).toBe(200);
      const ids: string[] = res.body.items.map(
        (item: { id: string }) => item.id,
      );
      return res.body.nextCursor == null
        ? ids
        : [...ids, ...(await queuedIdsFrom(res.body.nextCursor))];
    };

    it('lists the proposals waiting for the caller as a reviewer instead of looking up a proposal by that id (Reviewers Req 5.5)', async () => {
      const mine = await reviewedProposal();
      const notMine = await kit.storeProposal(
        [kit.editInput(await kit.createPage('not-mine'))],
        {
          approve: false,
          reviewers: [storedRef(userInput(fixtures.addedUser))],
        },
      );
      asUser(users.subscriber);

      const res = await getQueue({ limit: '50' });

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: mine._id, viewerRole: 'reviewer' }),
        ]),
      );
      const ids = await queuedIdsFrom(null);
      expect(ids).toContain(mine._id);
      expect(ids).not.toContain(notMine._id);
    });

    it('continues after the cursor, oldest first (Reviewers Req 5.5)', async () => {
      const older = await reviewedProposal();
      const newer = await reviewedProposal();
      asUser(users.subscriber);

      const first = await getQueue({ limit: '1' });
      const all = await queuedIdsFrom(null);
      const afterOlder = await getQueue({ cursor: older._id, limit: '1' });

      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(1);
      expect(first.body.nextCursor).toBe(first.body.items[0].id);
      expect(all.indexOf(older._id)).toBeLessThan(all.indexOf(newer._id));
      expect(afterOlder.body.items.map((i: { id: string }) => i.id)).toEqual([
        newer._id,
      ]);
    });

    it('lists only the pages the caller may view (Reviewers Req 5.6)', async () => {
      const visiblePage = await kit.createPage('visible');
      const hiddenPage = await requesterOnlyPage('hidden');
      const proposal = await reviewedProposal([visiblePage, hiddenPage]);
      asUser(users.subscriber);

      const res = await getQueue({ limit: '50' });

      const item = res.body.items.find(
        (i: { id: string }) => i.id === proposal._id,
      );
      expect(item.pages).toEqual([
        { id: visiblePage._id.toString(), path: visiblePage.path },
      ]);
      expect(JSON.stringify(res.body)).not.toContain(hiddenPage.path);
    });

    it.each([
      ['a malformed cursor', { cursor: 'not-an-object-id' }],
      ['an uppercase cursor', { cursor: 'AAAAAAAAAAAAAAAAAAAAAAAA' }],
      ['a zero limit', { limit: '0' }],
      ['a limit over the maximum', { limit: '51' }],
      ['a non-numeric limit', { limit: 'many' }],
    ])('answers %s with 400', async (_label, query) => {
      asUser(users.subscriber);

      const res = await getQueue(query);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('validation_failed');
      expect(res.body.items).toBeUndefined();
    });

    it('refuses a guest, and serves a read-only user and a page-read token like the other lists', async () => {
      const proposal = await reviewedProposal();
      const forReadOnly = await kit.storeProposal(
        [kit.editInput(await kit.createPage('for-read-only'))],
        {
          approve: false,
          reviewers: [storedRef(userInput(fixtures.readOnlyUser))],
        },
      );
      const idsOf = (res: { body: { items: { id: string }[] } }) =>
        res.body.items.map((item) => item.id);

      const guest = await getQueue();
      const readScope = await getQueue({ limit: '50' }).set(
        'Authorization',
        bearer(fixtures.reviewerReadToken),
      );
      asUser(fixtures.readOnlyUser);
      const readOnly = await getQueue({ limit: '50' });

      expect(guest.status).toBe(403);
      expect(readScope.status).toBe(200);
      expect(idsOf(readScope)).toContain(proposal._id);
      expect(readOnly.status).toBe(200);
      expect(idsOf(readOnly)).toContain(forReadOnly._id);
      expect(idsOf(readOnly)).not.toContain(proposal._id);
    });
  });
});
