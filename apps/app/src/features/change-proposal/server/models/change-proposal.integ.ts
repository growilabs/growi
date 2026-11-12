import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

import type { CreateProposalInput } from './change-proposal-types';

// Concurrency checks: 2 callers rarely overlap enough to expose a split read/write,
// so each round fires CONCURRENCY callers and repeats ROUNDS times.
const CONCURRENCY = 12;
const ROUNDS = 20;
const CONCURRENCY_TIMEOUT_MS = 120_000;

const newObjectId = (): string => new mongoose.Types.ObjectId().toString();

// Fixtures are scoped to requesters minted by this file, so cleanup never touches
// documents another integration file created in the same per-worker database.
const requesterIds: string[] = [];
const newRequester = (): string => {
  const id = newObjectId();
  requesterIds.push(id);
  return id;
};

const PAGE_A = newObjectId();
const PAGE_B = newObjectId();
const REVISION_A = newObjectId();

const editOp = (pageId = PAGE_A, body = 'edit body') =>
  ({
    type: 'edit',
    pageId,
    baseRevisionId: REVISION_A,
    body,
  }) as const;
const createOp = (path: string, body = 'create body') =>
  ({ type: 'create', path, body }) as const;

const createProposal = (
  overrides: Partial<CreateProposalInput> = {},
): ReturnType<typeof prisma.changeproposals.createProposal> =>
  prisma.changeproposals.createProposal({
    requester: overrides.requester ?? newRequester(),
    entry: 'ai-chat',
    perPageNotifications: true,
    operations: [editOp(), createOp('/cp-integ/new')],
    ...overrides,
  });

const rawDocument = (id: string) =>
  mongoose.connection
    .collection('changeproposals')
    .findOne({ _id: new mongoose.Types.ObjectId(id) });

const countTrue = (results: readonly boolean[]): number =>
  results.filter((r) => r).length;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe('ChangeProposal model (Prisma extension)', () => {
  afterAll(async () => {
    await prisma.changeproposals.deleteMany({
      where: { requester: { in: requesterIds } },
    });
  });

  describe('createProposal / findProposal', () => {
    it('stores operations with sequential indices and random keys, and reads them back', async () => {
      const created = await createProposal({ modelLabel: 'model-x' });

      const found = await prisma.changeproposals.findProposal(created._id);

      expect(found).not.toBeNull();
      expect(found?.lifecycle).toBe('open');
      expect(found?.modelLabel).toBe('model-x');
      expect(found?.perPageNotifications).toBe(true);
      expect(found?.operations.map((op) => op.index)).toStrictEqual([0, 1]);
      expect(found?.operations.map((op) => op.status)).toStrictEqual([
        'pending',
        'pending',
      ]);
      const keys = found?.operations.map((op) => op.key) ?? [];
      expect(new Set(keys).size).toBe(2);
      expect(found?.operations[0]).toMatchObject(editOp());
      expect(found?.operations[1]).toMatchObject(createOp('/cp-integ/new'));
    });

    it('reads back a Japanese model label and Japanese paths and bodies unchanged', async () => {
      const modelLabel = 'モデル名（日本語）　絵文字😀';
      const path = '/日本語/ページ　全角空白（かっこ）a.b[1]';
      const body = '# 日本語の本文\r\n絵文字😀\r\n';

      const created = await createProposal({
        modelLabel,
        operations: [editOp(PAGE_A, body), createOp(path, body)],
      });
      const found = await prisma.changeproposals.findProposal(created._id);

      expect(found?.modelLabel).toBe(modelLabel);
      expect(found?.operations).toMatchObject([
        { type: 'edit', body },
        { type: 'create', path, body },
      ]);
    });

    it('does not write absent optional fields, so the sparse indexes stay sparse', async () => {
      const created = await createProposal();

      const raw = await rawDocument(created._id);

      expect(raw).not.toBeNull();
      for (const field of [
        'revertOf',
        'basedOn',
        'applyLease',
        'lastAppliedAt',
        'expiresAt',
        'modelLabel',
      ]) {
        expect(raw).not.toHaveProperty(field);
      }
      expect(raw?.operations[0]).not.toHaveProperty('approvedAt');
      expect(raw?.operations[0]).not.toHaveProperty('reason');
    });

    it('stores basedOn, revertOf, revert targets and approvedAt when given', async () => {
      const base = await createProposal();
      const approvedAt = new Date();
      const revert = await createProposal({
        entry: 'revert',
        revertOf: base._id,
        perPageNotifications: false,
        operations: [
          {
            type: 'delete-completely',
            pageId: PAGE_A,
            expectedRevisionId: REVISION_A,
            revertTarget: {
              proposalId: base._id,
              operationKey: base.operations[1].key,
            },
            approvedAt,
          },
        ],
      });
      const followUp = await createProposal({
        requester: base.requester,
        basedOn: {
          proposalId: base._id,
          relation: 'follow-up',
          operationKeys: [base.operations[0].key],
        },
      });

      const readRevert = await prisma.changeproposals.findProposal(revert._id);
      const readFollowUp = await prisma.changeproposals.findProposal(
        followUp._id,
      );

      expect(readRevert?.revertOf).toBe(base._id);
      expect(readRevert?.perPageNotifications).toBe(false);
      expect(readRevert?.operations[0]).toMatchObject({
        type: 'delete-completely',
        approvedAt,
        revertTarget: {
          proposalId: base._id,
          operationKey: base.operations[1].key,
        },
      });
      expect(readFollowUp?.basedOn).toStrictEqual({
        proposalId: base._id,
        relation: 'follow-up',
        operationKeys: [base.operations[0].key],
      });
    });

    it('returns null for a missing or malformed id', async () => {
      expect(
        await prisma.changeproposals.findProposal(newObjectId()),
      ).toBeNull();
      expect(await prisma.changeproposals.findProposal('not-an-id')).toBeNull();
    });
  });

  describe('recordOperationOutcome', () => {
    it('rewrites only the targeted operation and leaves the other operations and bodies intact', async () => {
      const created = await createProposal({
        operations: [
          editOp(PAGE_A, 'body A'),
          editOp(PAGE_B, 'body B'),
          createOp('/cp-integ/c', 'body C'),
        ],
      });
      const now = new Date();
      const token = randomUUID();
      await prisma.changeproposals.claimApplyLease(created._id, token, now);
      const resultRevisionId = newObjectId();

      const written = await prisma.changeproposals.recordOperationOutcome(
        created._id,
        token,
        created.operations[1].key,
        { status: 'applied', resultPageId: PAGE_B, resultRevisionId },
        now,
      );

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(written).toBe(true);
      expect(read?.operations[1]).toMatchObject({
        status: 'applied',
        appliedAt: now,
        resultPageId: PAGE_B,
        resultRevisionId,
        body: 'body B',
      });
      expect(read?.operations[0]).toStrictEqual(created.operations[0]);
      expect(read?.operations[2]).toStrictEqual(created.operations[2]);
      expect(read?.lastAppliedAt).toStrictEqual(now);
      expect(read?.appliedPageIds).toStrictEqual([PAGE_B]);
    });

    it('does not add a page that is already in appliedPageIds', async () => {
      const created = await createProposal({
        operations: [editOp(PAGE_A), editOp(PAGE_A, 'second')],
      });
      const now = new Date();
      const token = randomUUID();
      await prisma.changeproposals.claimApplyLease(created._id, token, now);

      for (const op of created.operations) {
        await prisma.changeproposals.recordOperationOutcome(
          created._id,
          token,
          op.key,
          { status: 'applied', resultPageId: PAGE_A, resultRevisionId: null },
          now,
        );
      }

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.appliedPageIds).toStrictEqual([PAGE_A]);
    });

    it('refuses a write made with a different lease token', async () => {
      const created = await createProposal();
      const now = new Date();
      await prisma.changeproposals.claimApplyLease(
        created._id,
        randomUUID(),
        now,
      );

      const written = await prisma.changeproposals.recordOperationOutcome(
        created._id,
        randomUUID(),
        created.operations[0].key,
        { status: 'failed', reason: 'write-error' },
        now,
      );

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(written).toBe(false);
      expect(read?.operations[0].status).toBe('pending');
    });

    it('puts an operation back to waiting with a reason and clears approvedAt', async () => {
      const created = await createProposal({ operations: [editOp()] });
      const now = new Date();
      const token = randomUUID();
      await prisma.changeproposals.markApproved(
        created._id,
        created.requester,
        [created.operations[0].key],
        now,
      );
      await prisma.changeproposals.claimApplyLease(created._id, token, now);

      const written = await prisma.changeproposals.recordOperationOutcome(
        created._id,
        token,
        created.operations[0].key,
        { status: 'pending', reason: 'page-being-edited' },
        now,
      );

      const raw = await rawDocument(created._id);
      expect(written).toBe(true);
      expect(raw?.operations[0].status).toBe('pending');
      expect(raw?.operations[0].reason).toBe('page-being-edited');
      expect(raw?.operations[0]).not.toHaveProperty('approvedAt');
    });

    it('moves updatedAt forward when an outcome is recorded', async () => {
      const created = await createProposal();
      const token = randomUUID();
      await prisma.changeproposals.claimApplyLease(
        created._id,
        token,
        new Date(),
      );
      const beforeRecord = await prisma.changeproposals.findProposal(
        created._id,
      );
      await sleep(20);

      const written = await prisma.changeproposals.recordOperationOutcome(
        created._id,
        token,
        created.operations[0].key,
        { status: 'failed', reason: 'write-error' },
        new Date(),
      );

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(written).toBe(true);
      expect(read?.updatedAt.getTime()).toBeGreaterThan(
        beforeRecord?.updatedAt.getTime() ?? Number.POSITIVE_INFINITY,
      );
    });

    it('moves updatedAt forward when the lease is claimed', async () => {
      const created = await createProposal();
      await sleep(20);
      const now = new Date();
      const token = randomUUID();
      await prisma.changeproposals.claimApplyLease(created._id, token, now);

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(read?.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime(),
      );
    });
  });

  describe('conditional updates under concurrency', () => {
    it(
      'claimApplyLease lets exactly one of many concurrent callers win',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const created = await createProposal();
          const now = new Date();

          const results = await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
              prisma.changeproposals.claimApplyLease(
                created._id,
                randomUUID(),
                now,
              ),
            ),
          );

          expect(countTrue(results)).toBe(1);
        }
      },
      CONCURRENCY_TIMEOUT_MS,
    );

    it(
      'recordOperationOutcome lets exactly one of many concurrent callers win',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const created = await createProposal();
          const now = new Date();
          const token = randomUUID();
          await prisma.changeproposals.claimApplyLease(created._id, token, now);

          const results = await Promise.all(
            Array.from({ length: CONCURRENCY }, (_, i) =>
              prisma.changeproposals.recordOperationOutcome(
                created._id,
                token,
                created.operations[0].key,
                {
                  status: 'applied',
                  resultPageId: PAGE_A,
                  resultRevisionId: null,
                },
                new Date(now.getTime() + i),
              ),
            ),
          );

          expect(countTrue(results)).toBe(1);
        }
      },
      CONCURRENCY_TIMEOUT_MS,
    );

    it(
      'closeIfStillOpen (expiry) lets exactly one of many concurrent callers win',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const created = await createProposal({
            expiresAt: new Date(Date.now() - 1000),
          });
          const now = new Date();

          const results = await Promise.all(
            Array.from({ length: CONCURRENCY }, () =>
              prisma.changeproposals.closeIfStillOpen(
                created._id,
                'expired',
                now,
              ),
            ),
          );

          expect(countTrue(results)).toBe(1);
          const read = await prisma.changeproposals.findProposal(created._id);
          expect(read?.lifecycle).toBe('expired');
          expect(
            read?.operations.every(
              (op) => op.status === 'skipped' && op.reason === 'expired',
            ),
          ).toBe(true);
        }
      },
      CONCURRENCY_TIMEOUT_MS,
    );

    it(
      'settles the proposal when the last two pending operations are finished concurrently by apply and skip',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const created = await createProposal();
          const [applyKey, skipKey] = created.operations.map((op) => op.key);
          const now = new Date();
          const token = randomUUID();
          await prisma.changeproposals.claimApplyLease(created._id, token, now);

          await Promise.all([
            (async () => {
              await prisma.changeproposals.recordOperationOutcome(
                created._id,
                token,
                applyKey,
                {
                  status: 'applied',
                  resultPageId: PAGE_A,
                  resultRevisionId: null,
                },
                now,
              );
              await prisma.changeproposals.settleIfNoPending(created._id);
            })(),
            (async () => {
              await prisma.changeproposals.skipPendingOperations(
                created._id,
                created.requester,
                [skipKey],
              );
              await prisma.changeproposals.settleIfNoPending(created._id);
            })(),
          ]);

          const read = await prisma.changeproposals.findProposal(created._id);
          expect(read?.lifecycle).toBe('settled');
        }
      },
      CONCURRENCY_TIMEOUT_MS,
    );
  });

  describe('settleIfNoPending', () => {
    it('leaves a proposal that still has a pending operation open', async () => {
      const created = await createProposal();
      await prisma.changeproposals.skipPendingOperations(
        created._id,
        created.requester,
        [created.operations[0].key],
      );

      const settled = await prisma.changeproposals.settleIfNoPending(
        created._id,
      );

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(settled).toBe(false);
      expect(read?.lifecycle).toBe('open');
    });

    it('does not change a proposal that is no longer open', async () => {
      const created = await createProposal();
      await prisma.changeproposals.skipPendingOperations(
        created._id,
        created.requester,
        'all-pending',
        'discarded',
      );

      const settled = await prisma.changeproposals.settleIfNoPending(
        created._id,
      );

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(settled).toBe(false);
      expect(read?.lifecycle).toBe('discarded');
    });

    it('is found by findIdsOpenWithoutPending when the settle write was missed', async () => {
      const created = await createProposal({ operations: [editOp()] });
      const token = randomUUID();
      const now = new Date();
      await prisma.changeproposals.claimApplyLease(created._id, token, now);
      await prisma.changeproposals.recordOperationOutcome(
        created._id,
        token,
        created.operations[0].key,
        { status: 'stale', reason: 'base-revision-changed' },
        now,
      );

      const ids = await prisma.changeproposals.findIdsOpenWithoutPending(1000);

      expect(ids).toContain(created._id);
    });
  });

  describe('closeIfStillOpen', () => {
    it('withdraws an open proposal with pending operations and no live lease', async () => {
      const created = await createProposal();

      const closed = await prisma.changeproposals.closeIfStillOpen(
        created._id,
        'withdrawn',
        new Date(),
      );

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(closed).toBe(true);
      expect(read?.lifecycle).toBe('withdrawn');
      expect(
        read?.operations.every(
          (op) =>
            op.status === 'skipped' &&
            op.reason === 'withdrawn' &&
            op.approvedAt == null,
        ),
      ).toBe(true);
    });

    it('does not close a proposal that has no pending operation', async () => {
      const created = await createProposal({
        operations: [editOp()],
        expiresAt: new Date(Date.now() - 1000),
      });
      const token = randomUUID();
      const now = new Date();
      await prisma.changeproposals.claimApplyLease(created._id, token, now);
      await prisma.changeproposals.recordOperationOutcome(
        created._id,
        token,
        created.operations[0].key,
        { status: 'applied', resultPageId: PAGE_A, resultRevisionId: null },
        now,
      );
      await prisma.changeproposals.releaseApplyLease(created._id, token);

      const closed = await prisma.changeproposals.closeIfStillOpen(
        created._id,
        'expired',
        new Date(),
      );

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(closed).toBe(false);
      expect(read?.lifecycle).toBe('open');
      expect(read?.operations[0].status).toBe('applied');
    });

    it('does not withdraw a revert proposal and does not close a proposal under a live lease', async () => {
      const revert = await createProposal({
        entry: 'revert',
        revertOf: newObjectId(),
        operations: [
          {
            type: 'delete-completely',
            pageId: PAGE_A,
            expectedRevisionId: REVISION_A,
            revertTarget: { proposalId: newObjectId(), operationKey: 'k' },
          },
        ],
      });
      const leased = await createProposal();
      const now = new Date();
      await prisma.changeproposals.claimApplyLease(
        leased._id,
        randomUUID(),
        now,
      );

      expect(
        await prisma.changeproposals.closeIfStillOpen(
          revert._id,
          'withdrawn',
          now,
        ),
      ).toBe(false);
      expect(
        await prisma.changeproposals.closeIfStillOpen(
          leased._id,
          'withdrawn',
          now,
        ),
      ).toBe(false);
      expect(
        await prisma.changeproposals.findIdsOpenForWithdraw(now, 1000),
      ).not.toContain(revert._id);
    });
  });

  describe('apply lease', () => {
    it('extends and releases only with the holding token', async () => {
      const created = await createProposal();
      const token = randomUUID();
      const now = new Date();
      await prisma.changeproposals.claimApplyLease(created._id, token, now);

      expect(
        await prisma.changeproposals.extendApplyLease(
          created._id,
          randomUUID(),
          now,
        ),
      ).toBe(false);
      expect(
        await prisma.changeproposals.releaseApplyLease(
          created._id,
          randomUUID(),
        ),
      ).toBe(false);
      expect(
        await prisma.changeproposals.releaseApplyLease(created._id, token),
      ).toBe(true);

      const raw = await rawDocument(created._id);
      expect(raw).not.toHaveProperty('applyLease');
    });

    it('can be claimed again once the previous lease has expired', async () => {
      const created = await createProposal();
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.changeproposals.claimApplyLease(
        created._id,
        randomUUID(),
        past,
      );

      expect(
        await prisma.changeproposals.claimApplyLease(
          created._id,
          randomUUID(),
          new Date(),
        ),
      ).toBe(true);
    });

    it('lists a lease-less proposal that still has an approved pending operation as interrupted', async () => {
      const created = await createProposal();
      const notApproved = await createProposal();
      const now = new Date();
      await prisma.changeproposals.markApproved(
        created._id,
        created.requester,
        [created.operations[0].key],
        now,
      );

      const ids = await prisma.changeproposals.findIdsWithInterruptedApply(
        now,
        1000,
      );

      expect(ids).toContain(created._id);
      expect(ids).not.toContain(notApproved._id);
    });
  });

  describe('requester-scoped writes', () => {
    it('setPerPageNotifications rewrites only the requester’s open proposal', async () => {
      const open = await createProposal();
      const closed = await createProposal();
      await prisma.changeproposals.skipPendingOperations(
        closed._id,
        closed.requester,
        'all-pending',
        'discarded',
      );

      const byOther = await prisma.changeproposals.setPerPageNotifications(
        open._id,
        newObjectId(),
        false,
      );
      const onClosed = await prisma.changeproposals.setPerPageNotifications(
        closed._id,
        closed.requester,
        false,
      );
      const onOpen = await prisma.changeproposals.setPerPageNotifications(
        open._id,
        open.requester,
        false,
      );

      expect(byOther).toStrictEqual({ ok: false, code: 'not-found' });
      expect(onClosed).toStrictEqual({ ok: false, code: 'not-open' });
      expect(onOpen).toStrictEqual({ ok: true });
      expect(
        await prisma.changeproposals.readPerPageNotifications(open._id),
      ).toBe(false);
      expect(
        await prisma.changeproposals.readPerPageNotifications(closed._id),
      ).toBe(true);
    });

    it('discarding a proposal without pending operations settles it and reports not-open', async () => {
      const created = await createProposal({ operations: [editOp()] });
      const token = randomUUID();
      const now = new Date();
      await prisma.changeproposals.claimApplyLease(created._id, token, now);
      await prisma.changeproposals.recordOperationOutcome(
        created._id,
        token,
        created.operations[0].key,
        { status: 'applied', resultPageId: PAGE_A, resultRevisionId: null },
        now,
      );

      const result = await prisma.changeproposals.skipPendingOperations(
        created._id,
        created.requester,
        'all-pending',
        'discarded',
      );

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(result).toStrictEqual({ ok: false, code: 'not-open' });
      expect(read?.lifecycle).toBe('settled');
    });
  });

  describe('markOriginalOperation', () => {
    it('marks an applied operation as reverted, and not twice', async () => {
      const created = await createProposal({ operations: [editOp()] });
      const token = randomUUID();
      const now = new Date();
      await prisma.changeproposals.claimApplyLease(created._id, token, now);
      await prisma.changeproposals.recordOperationOutcome(
        created._id,
        token,
        created.operations[0].key,
        { status: 'applied', resultPageId: PAGE_A, resultRevisionId: null },
        now,
      );
      const revertProposalId = newObjectId();

      const first = await prisma.changeproposals.markOriginalOperation(
        created._id,
        created.operations[0].key,
        {
          status: 'reverted',
          revertedByProposalId: revertProposalId,
          revertedAt: now,
        },
      );
      const second = await prisma.changeproposals.markOriginalOperation(
        created._id,
        created.operations[0].key,
        { status: 'revert-refused', reason: 'edited-after-apply' },
      );

      const read = await prisma.changeproposals.findProposal(created._id);
      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(read?.operations[0]).toMatchObject({
        status: 'reverted',
        revertedByProposalId: revertProposalId,
        revertedAt: now,
      });
    });
  });

  describe('findLinkedProposals', () => {
    it('returns only the follow-ups and reworks of the base proposal, newest first', async () => {
      const base = await createProposal();
      const unrelated = await createProposal({ requester: base.requester });
      const followUp = await createProposal({
        requester: base.requester,
        basedOn: {
          proposalId: base._id,
          relation: 'follow-up',
          operationKeys: [base.operations[0].key],
        },
      });
      await sleep(5);
      const rework = await createProposal({
        requester: base.requester,
        basedOn: {
          proposalId: base._id,
          relation: 'rework',
          operationKeys: [base.operations[1].key],
        },
      });
      await createProposal({
        requester: base.requester,
        basedOn: {
          proposalId: unrelated._id,
          relation: 'rework',
          operationKeys: [unrelated.operations[0].key],
        },
      });

      const linked = await prisma.changeproposals.findLinkedProposals(base._id);

      expect(linked.map((p) => p.id)).toStrictEqual([rework._id, followUp._id]);
      expect(linked[0]).toMatchObject({
        requester: base.requester,
        entry: 'ai-chat',
        basedOn: {
          proposalId: base._id,
          relation: 'rework',
          operationKeys: [base.operations[1].key],
        },
      });
      expect(linked[0].operations[0]).toStrictEqual({
        key: rework.operations[0].key,
        type: 'edit',
        status: 'pending',
        pageId: PAGE_A,
      });
    });
  });

  describe('listing reads', () => {
    it('lists, counts and finds operations for marks without reading bodies', async () => {
      const requester = newRequester();
      const since = new Date(Date.now() - 1000);
      const first = await createProposal({ requester });
      await sleep(5);
      const second = await createProposal({ requester });
      await createProposal({
        requester,
        entry: 'revert',
        revertOf: first._id,
        operations: [
          {
            type: 'delete-completely',
            pageId: PAGE_A,
            expectedRevisionId: REVISION_A,
            revertTarget: { proposalId: first._id, operationKey: 'k' },
          },
        ],
      });
      const token = randomUUID();
      const now = new Date();
      await prisma.changeproposals.claimApplyLease(second._id, token, now);
      await prisma.changeproposals.recordOperationOutcome(
        second._id,
        token,
        second.operations[0].key,
        { status: 'applied', resultPageId: PAGE_A, resultRevisionId: null },
        now,
      );

      const mine = await prisma.changeproposals.listByRequester(requester, {
        skip: 0,
        take: 10,
      });
      const count = await prisma.changeproposals.countCreatedSince(
        requester,
        since,
      );
      const applied = await prisma.changeproposals.listAppliedAfterCursor(
        null,
        1000,
      );
      const marked = await prisma.changeproposals.findOperationsForMarks([
        { proposalId: second._id, operationKey: second.operations[0].key },
      ]);

      expect(mine).toHaveLength(3);
      expect(mine[1].id).toBe(second._id);
      expect(mine[1].operations[0]).not.toHaveProperty('body');
      expect(count).toBe(2);
      expect(applied.map((p) => p.id)).toContain(second._id);
      expect(applied.map((p) => p.id)).not.toContain(first._id);
      expect(marked).toHaveLength(1);
      expect(marked[0].operations.map((op) => op.key)).toStrictEqual([
        second.operations[0].key,
      ]);
    });

    it('pages applied proposals by the lastAppliedAt/id cursor', async () => {
      const requester = newRequester();
      const docs: { id: string; at: Date }[] = [];
      for (let i = 0; i < 3; i++) {
        const created = await createProposal({ requester });
        const token = randomUUID();
        const at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 + i);
        await prisma.changeproposals.claimApplyLease(created._id, token, at);
        await prisma.changeproposals.recordOperationOutcome(
          created._id,
          token,
          created.operations[0].key,
          { status: 'applied', resultPageId: PAGE_A, resultRevisionId: null },
          at,
        );
        docs.push({ id: created._id, at });
      }

      const page1 = await prisma.changeproposals.listAppliedAfterCursor(
        null,
        2,
      );
      const last = page1[page1.length - 1];
      const page2 = await prisma.changeproposals.listAppliedAfterCursor(
        { lastAppliedAt: last.lastAppliedAt ?? new Date(0), id: last.id },
        1,
      );

      expect(page1.map((p) => p.id)).toStrictEqual([docs[2].id, docs[1].id]);
      expect(page2.map((p) => p.id)).toStrictEqual([docs[0].id]);
    });

    it('lists due proposals for expiry only when they have a pending operation', async () => {
      const due = await createProposal({
        expiresAt: new Date(Date.now() - 1000),
      });
      const notDue = await createProposal({
        expiresAt: new Date(Date.now() + 60_000),
      });
      const dueWithoutPending = await createProposal({
        operations: [editOp()],
        expiresAt: new Date(Date.now() - 1000),
      });
      const token = randomUUID();
      const appliedAt = new Date();
      await prisma.changeproposals.claimApplyLease(
        dueWithoutPending._id,
        token,
        appliedAt,
      );
      await prisma.changeproposals.recordOperationOutcome(
        dueWithoutPending._id,
        token,
        dueWithoutPending.operations[0].key,
        { status: 'applied', resultPageId: PAGE_A, resultRevisionId: null },
        appliedAt,
      );
      await prisma.changeproposals.releaseApplyLease(
        dueWithoutPending._id,
        token,
      );

      const ids = await prisma.changeproposals.findIdsDueForExpiry(
        new Date(),
        1000,
      );

      expect(ids).toContain(due._id);
      expect(ids).not.toContain(notDue._id);
      expect(ids).not.toContain(dueWithoutPending._id);
    });
  });
});
