import { randomUUID } from 'node:crypto';

import { prisma } from '~/utils/prisma';

import {
  CONCURRENCY,
  CONCURRENCY_TIMEOUT_MS,
  createProposal,
  deleteProposalsOfMintedRequesters,
  identityOf,
  newObjectId,
  ROUNDS,
  reviewerRef,
  sleep,
} from './change-proposal.test-kit';

describe('ChangeProposal model (Prisma extension)', () => {
  afterAll(async () => {
    await deleteProposalsOfMintedRequesters();
  });

  describe('adding and removing reviewers', () => {
    const activeEntriesOf = async (id: string) => {
      const read = await prisma.changeproposals.findProposal(id);
      return (read?.reviewers ?? []).filter((r) => r.removedAt == null);
    };

    it('adds users, user groups and external user groups with who added them and when (Req 18.1, 18.2, 18.10)', async () => {
      const created = await createProposal();
      const actor = identityOf(created.requester);
      const inputs = [
        { kind: 'user', id: newObjectId() },
        { kind: 'user-group', id: newObjectId() },
        { kind: 'external-user-group', id: newObjectId() },
      ] as const;
      const now = new Date();

      const result = await prisma.changeproposals.addReviewers(
        created._id,
        actor,
        inputs,
        now,
      );

      expect(result).toStrictEqual({ ok: true, added: inputs });
      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.reviewers).toStrictEqual(
        inputs.map((input) => ({
          ...input,
          addedBy: created.requester,
          addedAt: now,
        })),
      );
    });

    it('lets an active reviewer, including a group member, add a reviewer (Req 18.1)', async () => {
      const groupId = newObjectId();
      const created = await createProposal({
        reviewers: [reviewerRef('user-group', groupId)],
      });
      const member = newObjectId();
      const input = { kind: 'user', id: newObjectId() } as const;

      const result = await prisma.changeproposals.addReviewers(
        created._id,
        identityOf(member, { userGroupIds: [groupId] }),
        [input],
        new Date(),
      );

      expect(result).toStrictEqual({ ok: true, added: [input] });
      expect(await activeEntriesOf(created._id)).toMatchObject([
        { kind: 'user-group', id: groupId },
        { ...input, addedBy: member },
      ]);
    });

    it('changes nothing and reports nothing added for a reviewer who is already active (Req 18.6)', async () => {
      const existing = reviewerRef('user', newObjectId());
      const created = await createProposal({ reviewers: [existing] });

      const result = await prisma.changeproposals.addReviewers(
        created._id,
        identityOf(created.requester),
        [{ kind: 'user', id: existing.id }],
        new Date(),
      );

      expect(result).toStrictEqual({ ok: true, added: [] });
      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.reviewers).toStrictEqual([existing]);
    });

    it('treats the same id under another kind as a different reviewer (Req 18.6)', async () => {
      const sharedId = newObjectId();
      const created = await createProposal({
        reviewers: [reviewerRef('user', sharedId)],
      });

      const result = await prisma.changeproposals.addReviewers(
        created._id,
        identityOf(created.requester),
        [{ kind: 'user-group', id: sharedId }],
        new Date(),
      );

      expect(result).toStrictEqual({
        ok: true,
        added: [{ kind: 'user-group', id: sharedId }],
      });
    });

    it('marks a removed reviewer with who removed them and when, and keeps the entry (Req 18.3, 18.10)', async () => {
      const kept = reviewerRef('user', newObjectId());
      const removed = reviewerRef('user-group', newObjectId());
      const created = await createProposal({ reviewers: [kept, removed] });
      const now = new Date();

      // A reviewer may remove anyone, here including a reviewer someone else added.
      const result = await prisma.changeproposals.removeReviewers(
        created._id,
        identityOf(kept.id),
        [{ kind: removed.kind, id: removed.id }],
        now,
      );

      expect(result).toStrictEqual({ ok: true });
      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.reviewers).toStrictEqual([
        kept,
        { ...removed, removedBy: kept.id, removedAt: now },
      ]);
    });

    it('lets a reviewer remove themselves (Req 18.3)', async () => {
      const self = reviewerRef('user', newObjectId());
      const created = await createProposal({ reviewers: [self] });

      const result = await prisma.changeproposals.removeReviewers(
        created._id,
        identityOf(self.id),
        [{ kind: 'user', id: self.id }],
        new Date(),
      );

      expect(result).toStrictEqual({ ok: true });
      expect(await activeEntriesOf(created._id)).toStrictEqual([]);
    });

    it('changes nothing when the reviewer to remove is not an active reviewer (Req 18.7)', async () => {
      const existing = reviewerRef('user', newObjectId());
      const created = await createProposal({ reviewers: [existing] });

      const result = await prisma.changeproposals.removeReviewers(
        created._id,
        identityOf(created.requester),
        [{ kind: 'user', id: newObjectId() }],
        new Date(),
      );

      expect(result).toStrictEqual({ ok: true });
      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.reviewers).toStrictEqual([existing]);
    });

    it('adds a new entry for a removed reviewer added back, and a later removal leaves the old record as it was (Req 18.10)', async () => {
      const reviewerId = newObjectId();
      const created = await createProposal();
      const actor = identityOf(created.requester);
      const input = { kind: 'user', id: reviewerId } as const;
      const firstRemoval = new Date(Date.now() - 2000);
      const secondRemoval = new Date();
      await prisma.changeproposals.addReviewers(
        created._id,
        actor,
        [input],
        new Date(Date.now() - 3000),
      );
      await prisma.changeproposals.removeReviewers(
        created._id,
        actor,
        [input],
        firstRemoval,
      );

      const readded = await prisma.changeproposals.addReviewers(
        created._id,
        actor,
        [input],
        new Date(Date.now() - 1000),
      );
      await prisma.changeproposals.removeReviewers(
        created._id,
        actor,
        [input],
        secondRemoval,
      );

      expect(readded).toStrictEqual({ ok: true, added: [input] });
      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.reviewers.map((r) => r.removedAt)).toStrictEqual([
        firstRemoval,
        secondRemoval,
      ]);
    });

    it('keeps the approvals, rejections and abstentions of a removed reviewer (Req 18.12)', async () => {
      const reviewer = reviewerRef('user', newObjectId());
      const created = await createProposal({ reviewers: [reviewer] });
      const [approved, abstained] = created.operations.map((op) => op.key);
      await prisma.changeproposals.markApproved(
        created._id,
        {
          approver: identityOf(reviewer.id),
          channel: 'api',
          decisionToken: randomUUID(),
        },
        [approved],
        new Date(),
      );
      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer.id),
        {
          kind: 'abstain',
          target: { scope: 'operations', operationKeys: [abstained] },
          channel: 'ui',
        },
        new Date(),
      );
      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer.id),
        {
          kind: 'reject',
          target: { scope: 'whole' },
          channel: 'ui',
          comment: 'no',
        },
        new Date(),
      );
      const before = await prisma.changeproposals.findProposal(created._id);

      await prisma.changeproposals.removeReviewers(
        created._id,
        identityOf(created.requester),
        [{ kind: 'user', id: reviewer.id }],
        new Date(),
      );

      const after = await prisma.changeproposals.findProposal(created._id);
      expect(before?.reviews).toHaveLength(2);
      expect(before?.operations[0].approvedBy).toBe(reviewer.id);
      expect(after?.reviews).toStrictEqual(before?.reviews);
      expect(after?.operations).toStrictEqual(before?.operations);
    });

    it('accepts a malformed reviewer id to remove and changes nothing (Req 18.7)', async () => {
      const existing = reviewerRef('user', newObjectId());
      const created = await createProposal({ reviewers: [existing] });

      const result = await prisma.changeproposals.removeReviewers(
        created._id,
        identityOf(created.requester),
        [{ kind: 'user', id: 'not-an-id' }],
        new Date(),
      );

      expect(result).toStrictEqual({ ok: true });
      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.reviewers).toStrictEqual([existing]);
    });

    it('answers not-open and changes nothing on a closed proposal (Req 18.8)', async () => {
      const existing = reviewerRef('user', newObjectId());
      const created = await createProposal({ reviewers: [existing] });
      await prisma.changeproposals.closeIfStillOpen(
        created._id,
        'withdrawn',
        new Date(),
      );
      const actor = identityOf(created.requester);

      const added = await prisma.changeproposals.addReviewers(
        created._id,
        actor,
        [{ kind: 'user', id: newObjectId() }],
        new Date(),
      );
      const removed = await prisma.changeproposals.removeReviewers(
        created._id,
        actor,
        [{ kind: 'user', id: existing.id }],
        new Date(),
      );

      expect(added).toStrictEqual({ ok: false, code: 'not-open' });
      expect(removed).toStrictEqual({ ok: false, code: 'not-open' });
      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.reviewers).toStrictEqual([existing]);
    });

    it('answers not-found and changes nothing for someone who is neither the requester nor a reviewer (Req 16.7)', async () => {
      const existing = reviewerRef('user', newObjectId());
      const created = await createProposal({ reviewers: [existing] });
      const outsider = identityOf(newObjectId());

      const added = await prisma.changeproposals.addReviewers(
        created._id,
        outsider,
        [{ kind: 'user', id: newObjectId() }],
        new Date(),
      );
      const removed = await prisma.changeproposals.removeReviewers(
        created._id,
        outsider,
        [{ kind: 'user', id: existing.id }],
        new Date(),
      );

      expect(added).toStrictEqual({ ok: false, code: 'not-found' });
      expect(removed).toStrictEqual({ ok: false, code: 'not-found' });
      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.reviewers).toStrictEqual([existing]);
    });

    it(
      'keeps every reviewer added concurrently by different people (Req 18.1)',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const actors = Array.from({ length: CONCURRENCY }, () =>
            reviewerRef('user', newObjectId()),
          );
          const created = await createProposal({ reviewers: actors });
          const newcomers = actors.map(() => ({
            kind: 'user' as const,
            id: newObjectId(),
          }));

          const results = await Promise.all(
            actors.map((actor, i) =>
              prisma.changeproposals.addReviewers(
                created._id,
                identityOf(actor.id),
                [newcomers[i]],
                new Date(),
              ),
            ),
          );

          expect(results).toStrictEqual(
            newcomers.map((input) => ({ ok: true, added: [input] })),
          );
          const activeIds = (await activeEntriesOf(created._id)).map(
            (r) => r.id,
          );
          expect(activeIds).toStrictEqual(
            expect.arrayContaining(newcomers.map((n) => n.id)),
          );
          expect(activeIds).toHaveLength(CONCURRENCY * 2);
        }
      },
      CONCURRENCY_TIMEOUT_MS,
    );

    it(
      'adds the same reviewer only once when many people add them concurrently (Req 18.6)',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const actors = Array.from({ length: CONCURRENCY }, () =>
            reviewerRef('user', newObjectId()),
          );
          const created = await createProposal({ reviewers: actors });
          const input = { kind: 'user-group' as const, id: newObjectId() };

          const results = await Promise.all(
            actors.map((actor) =>
              prisma.changeproposals.addReviewers(
                created._id,
                identityOf(actor.id),
                [input],
                new Date(),
              ),
            ),
          );

          const reportedAdded = results.filter(
            (r) => r.ok && r.added.length > 0,
          );
          expect(reportedAdded).toHaveLength(1);
          const entries = (await activeEntriesOf(created._id)).filter(
            (r) => r.kind === input.kind && r.id === input.id,
          );
          expect(entries).toHaveLength(1);
        }
      },
      CONCURRENCY_TIMEOUT_MS,
    );
  });

  describe('reviews (reject and abstain records)', () => {
    const reviewsOf = async (id: string) =>
      (await prisma.changeproposals.findProposal(id))?.reviews ?? [];

    const setUp = async () => {
      const reviewer = newObjectId();
      const other = newObjectId();
      const created = await createProposal({
        reviewers: [reviewerRef('user', reviewer), reviewerRef('user', other)],
      });
      const [first, second] = created.operations.map((op) => op.key);
      return { created, reviewer, other, first, second };
    };

    it('records a rejection of each chosen operation with who, when, the comment and the channel (Req 17.1)', async () => {
      const { created, reviewer, first, second } = await setUp();
      const now = new Date();

      const result = await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        {
          kind: 'reject',
          target: { scope: 'operations', operationKeys: [first, second] },
          comment: '<b>not this</b>',
          channel: 'api',
        },
        now,
      );

      expect(result).toStrictEqual({ ok: true });
      expect(await reviewsOf(created._id)).toStrictEqual(
        [first, second].map((operationKey) => ({
          kind: 'reject',
          operationKey,
          by: reviewer,
          at: now,
          comment: '<b>not this</b>',
          channel: 'api',
        })),
      );
    });

    it('records a rejection of the whole proposal without an operation key (Req 17.2)', async () => {
      const { created, reviewer } = await setUp();
      const now = new Date();

      const result = await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        { kind: 'reject', target: { scope: 'whole' }, channel: 'ui' },
        now,
      );

      expect(result).toStrictEqual({ ok: true });
      expect(await reviewsOf(created._id)).toStrictEqual([
        { kind: 'reject', by: reviewer, at: now, channel: 'ui' },
      ]);
    });

    it('records an abstention of a chosen operation (Req 17.3)', async () => {
      const { created, reviewer, first } = await setUp();
      const now = new Date();

      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        {
          kind: 'abstain',
          target: { scope: 'operations', operationKeys: [first] },
          channel: 'ai-tool',
        },
        now,
      );

      expect(await reviewsOf(created._id)).toStrictEqual([
        {
          kind: 'abstain',
          operationKey: first,
          by: reviewer,
          at: now,
          channel: 'ai-tool',
        },
      ]);
    });

    it('leaves the status and approval of every operation and the lifecycle as they were (Req 17.9)', async () => {
      const { created, reviewer, other, first, second } = await setUp();
      await prisma.changeproposals.markApproved(
        created._id,
        {
          approver: identityOf(other),
          channel: 'ui',
          decisionToken: randomUUID(),
        },
        [second],
        new Date(),
      );
      const before = await prisma.changeproposals.findProposal(created._id);

      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        {
          kind: 'reject',
          target: { scope: 'operations', operationKeys: [first, second] },
          channel: 'ui',
        },
        new Date(),
      );
      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        { kind: 'reject', target: { scope: 'whole' }, channel: 'ui' },
        new Date(),
      );

      const after = await prisma.changeproposals.findProposal(created._id);
      expect(after?.lifecycle).toBe(before?.lifecycle);
      expect(after?.operations).toStrictEqual(before?.operations);
    });

    it('replaces the same person’s earlier record of the same operation, and leaves other records alone (Req 17.4)', async () => {
      const { created, reviewer, other, first, second } = await setUp();
      const earlier = new Date(Date.now() - 1000);
      const later = new Date();
      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        {
          kind: 'reject',
          target: { scope: 'operations', operationKeys: [first, second] },
          channel: 'ui',
        },
        earlier,
      );
      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        { kind: 'reject', target: { scope: 'whole' }, channel: 'ui' },
        earlier,
      );
      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(other),
        {
          kind: 'reject',
          target: { scope: 'operations', operationKeys: [first] },
          channel: 'ui',
        },
        earlier,
      );

      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        {
          kind: 'abstain',
          target: { scope: 'operations', operationKeys: [first] },
          channel: 'api',
        },
        later,
      );

      const reviews = await reviewsOf(created._id);
      expect(reviews).toHaveLength(4);
      expect(reviews).toStrictEqual(
        expect.arrayContaining([
          {
            kind: 'abstain',
            operationKey: first,
            by: reviewer,
            at: later,
            channel: 'api',
          },
          {
            kind: 'reject',
            operationKey: second,
            by: reviewer,
            at: earlier,
            channel: 'ui',
          },
          { kind: 'reject', by: reviewer, at: earlier, channel: 'ui' },
          {
            kind: 'reject',
            operationKey: first,
            by: other,
            at: earlier,
            channel: 'ui',
          },
        ]),
      );
    });

    it('replaces the same person’s earlier whole rejection, and keeps their records of operations (Req 17.4)', async () => {
      const { created, reviewer, first } = await setUp();
      const later = new Date();
      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        {
          kind: 'abstain',
          target: { scope: 'operations', operationKeys: [first] },
          channel: 'ui',
        },
        new Date(Date.now() - 1000),
      );
      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        {
          kind: 'reject',
          target: { scope: 'whole' },
          comment: 'first',
          channel: 'ui',
        },
        new Date(Date.now() - 1000),
      );

      await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        {
          kind: 'reject',
          target: { scope: 'whole' },
          comment: 'second',
          channel: 'ui',
        },
        later,
      );

      const reviews = await reviewsOf(created._id);
      expect(reviews.filter((r) => r.operationKey == null)).toStrictEqual([
        {
          kind: 'reject',
          by: reviewer,
          at: later,
          comment: 'second',
          channel: 'ui',
        },
      ]);
      expect(reviews.filter((r) => r.operationKey === first)).toHaveLength(1);
    });

    it('answers not-found and records nothing for someone who is not a reviewer (Req 17.11)', async () => {
      const { created, first } = await setUp();

      const result = await prisma.changeproposals.addReviews(
        created._id,
        identityOf(newObjectId()),
        {
          kind: 'reject',
          target: { scope: 'operations', operationKeys: [first] },
          channel: 'ui',
        },
        new Date(),
      );

      expect(result).toStrictEqual({ ok: false, code: 'not-found' });
      expect(await reviewsOf(created._id)).toStrictEqual([]);
    });

    it('answers not-open and records nothing on a closed proposal (Req 16.9)', async () => {
      const { created, reviewer, first } = await setUp();
      await prisma.changeproposals.closeIfStillOpen(
        created._id,
        'withdrawn',
        new Date(),
      );

      const result = await prisma.changeproposals.addReviews(
        created._id,
        identityOf(reviewer),
        {
          kind: 'reject',
          target: { scope: 'operations', operationKeys: [first] },
          channel: 'ui',
        },
        new Date(),
      );

      expect(result).toStrictEqual({ ok: false, code: 'not-open' });
      expect(await reviewsOf(created._id)).toStrictEqual([]);
    });

    describe('keeping the earlier record when a replacement is not written', () => {
      const abstainOn = (id: string, reviewer: string, key: string) =>
        prisma.changeproposals.addReviews(
          id,
          identityOf(reviewer),
          {
            kind: 'abstain',
            target: { scope: 'operations', operationKeys: [key] },
            channel: 'api',
          },
          new Date(),
        );
      const recordsOf = async (id: string, reviewer: string, key: string) =>
        (await reviewsOf(id)).filter(
          (r) => r.by === reviewer && r.operationKey === key,
        );
      const setUpWithRejection = async () => {
        const fixture = await setUp();
        await prisma.changeproposals.addReviews(
          fixture.created._id,
          identityOf(fixture.reviewer),
          {
            kind: 'reject',
            target: { scope: 'operations', operationKeys: [fixture.first] },
            channel: 'ui',
          },
          new Date(Date.now() - 1000),
        );
        return fixture;
      };

      it('answers not-open and keeps the earlier record when the proposal has closed (Req 17.4, 16.9)', async () => {
        const { created, reviewer, first } = await setUpWithRejection();
        await prisma.changeproposals.closeIfStillOpen(
          created._id,
          'withdrawn',
          new Date(),
        );

        const result = await abstainOn(created._id, reviewer, first);

        expect(result).toStrictEqual({ ok: false, code: 'not-open' });
        expect(await recordsOf(created._id, reviewer, first)).toMatchObject([
          { kind: 'reject' },
        ]);
      });

      it('answers not-found and keeps the earlier record when the reviewer has been removed (Req 17.4, 18.12)', async () => {
        const { created, reviewer, first } = await setUpWithRejection();
        await prisma.changeproposals.removeReviewers(
          created._id,
          identityOf(created.requester),
          [{ kind: 'user', id: reviewer }],
          new Date(),
        );

        const result = await abstainOn(created._id, reviewer, first);

        expect(result).toStrictEqual({ ok: false, code: 'not-found' });
        expect(await recordsOf(created._id, reviewer, first)).toMatchObject([
          { kind: 'reject' },
        ]);
      });

      it(
        'never loses both records when the proposal closes during the replacement (Req 17.4)',
        async () => {
          for (let round = 0; round < ROUNDS * 3; round++) {
            const { created, reviewer, first } = await setUpWithRejection();

            await Promise.all([
              abstainOn(created._id, reviewer, first),
              (async () => {
                await sleep(round % 4);
                await prisma.changeproposals.closeIfStillOpen(
                  created._id,
                  'withdrawn',
                  new Date(),
                );
              })(),
            ]);

            expect(
              (await recordsOf(created._id, reviewer, first)).length,
            ).toBeGreaterThan(0);
          }
        },
        CONCURRENCY_TIMEOUT_MS,
      );

      it(
        'never loses both records when the reviewer is removed during the replacement (Req 17.4, 18.12)',
        async () => {
          for (let round = 0; round < ROUNDS * 3; round++) {
            const { created, reviewer, first } = await setUpWithRejection();

            await Promise.all([
              abstainOn(created._id, reviewer, first),
              (async () => {
                await sleep(round % 4);
                await prisma.changeproposals.removeReviewers(
                  created._id,
                  identityOf(created.requester),
                  [{ kind: 'user', id: reviewer }],
                  new Date(),
                );
              })(),
            ]);

            expect(
              (await recordsOf(created._id, reviewer, first)).length,
            ).toBeGreaterThan(0);
          }
        },
        CONCURRENCY_TIMEOUT_MS,
      );
    });

    describe('clearing on approval', () => {
      const rejectEverything = async (
        id: string,
        reviewer: string,
        keys: readonly string[],
      ) => {
        await prisma.changeproposals.addReviews(
          id,
          identityOf(reviewer),
          {
            kind: 'reject',
            target: { scope: 'operations', operationKeys: keys },
            channel: 'ui',
          },
          new Date(),
        );
        await prisma.changeproposals.addReviews(
          id,
          identityOf(reviewer),
          { kind: 'reject', target: { scope: 'whole' }, channel: 'ui' },
          new Date(),
        );
      };

      it('removes the approver’s records of the approved operations, and keeps their whole rejection and others’ records (Req 17.4)', async () => {
        const { created, reviewer, other, first, second } = await setUp();
        await rejectEverything(created._id, reviewer, [first, second]);
        await rejectEverything(created._id, other, [first]);

        await prisma.changeproposals.clearReviewsOnApproval(
          created._id,
          reviewer,
          [first],
          { wholeProposal: false },
        );

        const reviews = await reviewsOf(created._id);
        expect(
          reviews
            .filter((r) => r.by === reviewer)
            .map((r) => r.operationKey ?? 'whole'),
        ).toStrictEqual([second, 'whole']);
        expect(reviews.filter((r) => r.by === other)).toHaveLength(2);
      });

      it('also removes the approver’s whole rejection when the whole proposal is approved (Req 17.4)', async () => {
        const { created, reviewer, other, first, second } = await setUp();
        await rejectEverything(created._id, reviewer, [first, second]);
        await rejectEverything(created._id, other, [first]);

        await prisma.changeproposals.clearReviewsOnApproval(
          created._id,
          reviewer,
          [first, second],
          { wholeProposal: true },
        );

        const reviews = await reviewsOf(created._id);
        expect(reviews.filter((r) => r.by === reviewer)).toStrictEqual([]);
        expect(reviews.filter((r) => r.by === other)).toHaveLength(2);
      });

      it('removes the approver’s records even after the approval closed the proposal (Req 17.4)', async () => {
        const { created, reviewer, first, second } = await setUp();
        await rejectEverything(created._id, reviewer, [first, second]);
        await prisma.changeproposals.closeIfStillOpen(
          created._id,
          'withdrawn',
          new Date(),
        );

        await prisma.changeproposals.clearReviewsOnApproval(
          created._id,
          reviewer,
          [first, second],
          { wholeProposal: true },
        );

        expect(await reviewsOf(created._id)).toStrictEqual([]);
      });
    });
  });
});
