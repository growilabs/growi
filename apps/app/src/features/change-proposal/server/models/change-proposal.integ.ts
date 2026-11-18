import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

import type {
  ReviewChannel,
  ReviewerKind,
  ReviewerRef,
} from '../../interfaces';
import type { ViewerIdentity } from '../domain';
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

const identityOf = (
  userId: string,
  groups: {
    readonly userGroupIds?: readonly string[];
    readonly externalUserGroupIds?: readonly string[];
  } = {},
): ViewerIdentity => ({
  userId,
  userGroupIds: new Set(groups.userGroupIds ?? []),
  externalUserGroupIds: new Set(groups.externalUserGroupIds ?? []),
});

const reviewerRef = (
  kind: ReviewerKind,
  id: string,
  removedAt?: Date,
): ReviewerRef => ({
  kind,
  id,
  addedBy: newObjectId(),
  addedAt: new Date(),
  ...(removedAt == null ? {} : { removedBy: newObjectId(), removedAt }),
});

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

  describe('reviewer fields (Reviewers Req 1.1, 1.8)', () => {
    const approveRaw = (id: string, approver: string) =>
      mongoose.connection.collection('changeproposals').updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        {
          $set: {
            'operations.$[].approvedAt': new Date(),
            'operations.$[].approvedBy': new mongoose.Types.ObjectId(approver),
            'operations.$[].approvedChannel': 'ui',
            'operations.$[].decisionToken': 'token-1',
          },
        },
      );

    const expectApprovalCleared = async (id: string) => {
      const raw = await rawDocument(id);
      const read = await prisma.changeproposals.findProposal(id);
      for (const op of raw?.operations ?? []) {
        for (const field of [
          'approvedAt',
          'approvedBy',
          'approvedChannel',
          'decisionToken',
        ]) {
          expect(op).not.toHaveProperty(field);
        }
      }
      for (const op of read?.operations ?? []) {
        expect(op.approvedBy).toBeUndefined();
        expect(op.approvedChannel).toBeUndefined();
        expect(op.decisionToken).toBeUndefined();
      }
    };

    it('reads back the purpose and the reviewers given at creation', async () => {
      const reviewerId = newObjectId();
      const addedAt = new Date();
      const created = await createProposal({
        purpose: 'why',
        reviewers: [
          { kind: 'user', id: reviewerId, addedBy: newObjectId(), addedAt },
        ],
      });

      const found = await prisma.changeproposals.findProposal(created._id);

      expect(found?.purpose).toBe('why');
      expect(found?.reviewers).toMatchObject([
        { kind: 'user', id: reviewerId, addedAt },
      ]);
      expect(found?.reviews).toStrictEqual([]);
    });

    it('always stores reviewers and reviews as arrays, even when none are given', async () => {
      const created = await createProposal();

      const raw = await rawDocument(created._id);

      expect(raw?.reviewers).toStrictEqual([]);
      expect(raw?.reviews).toStrictEqual([]);
    });

    it('reads a document stored before the fields existed as empty arrays', async () => {
      const created = await createProposal();
      await mongoose.connection
        .collection('changeproposals')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(created._id) },
          { $unset: { reviewers: '', reviews: '', purpose: '' } },
        );

      const found = await prisma.changeproposals.findProposal(created._id);
      const [listed] = await prisma.changeproposals.findMany({
        where: { id: created._id },
        select: { reviewers: true, reviews: true, purpose: true },
      });

      expect(found?.reviewers).toStrictEqual([]);
      expect(found?.reviews).toStrictEqual([]);
      expect(found).not.toHaveProperty('purpose');
      expect(listed.reviewers).toStrictEqual([]);
    });

    it('reads the approval fields of an approved operation', async () => {
      const created = await createProposal({ operations: [editOp()] });
      const approver = newObjectId();
      await approveRaw(created._id, approver);

      const found = await prisma.changeproposals.findProposal(created._id);

      expect(found?.operations[0]).toMatchObject({
        approvedBy: approver,
        approvedChannel: 'ui',
        decisionToken: 'token-1',
      });
    });

    it('clears the approval fields when the requester skips an operation', async () => {
      const created = await createProposal({ operations: [editOp()] });
      await approveRaw(created._id, newObjectId());

      await prisma.changeproposals.skipPendingOperations(
        created._id,
        created.requester,
        'all-pending',
      );

      await expectApprovalCleared(created._id);
    });

    it('clears the approval fields when a proposal is closed', async () => {
      const created = await createProposal({ operations: [editOp()] });
      await approveRaw(created._id, newObjectId());

      await prisma.changeproposals.closeIfStillOpen(
        created._id,
        'withdrawn',
        new Date(),
      );

      await expectApprovalCleared(created._id);
    });

    it('clears the approval fields when an operation goes back to waiting', async () => {
      const created = await createProposal({ operations: [editOp()] });
      await approveRaw(created._id, newObjectId());
      const token = randomUUID();
      const now = new Date();
      await prisma.changeproposals.claimApplyLease(created._id, token, now);

      await prisma.changeproposals.recordOperationOutcome(
        created._id,
        token,
        created.operations[0].key,
        { status: 'pending', reason: 'page-being-edited' },
        now,
      );

      await expectApprovalCleared(created._id);
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

  describe('markApproved by a reviewer', () => {
    const approveAs = (
      id: string,
      approver: ViewerIdentity,
      keys: readonly string[],
      options: { channel?: ReviewChannel; token?: string; now?: Date } = {},
    ) =>
      prisma.changeproposals.markApproved(
        id,
        {
          approver,
          channel: options.channel ?? 'ui',
          decisionToken: options.token ?? randomUUID(),
        },
        keys,
        options.now ?? new Date(),
      );

    const approvalFieldsOf = async (id: string, key: string) => {
      const read = await prisma.changeproposals.findProposal(id);
      const op = read?.operations.find((o) => o.key === key);
      return {
        approvedAt: op?.approvedAt,
        approvedBy: op?.approvedBy,
        approvedChannel: op?.approvedChannel,
        decisionToken: op?.decisionToken,
      };
    };

    const noApproval = {
      approvedAt: undefined,
      approvedBy: undefined,
      approvedChannel: undefined,
      decisionToken: undefined,
    };

    it('writes the approver, channel, time and request token on the chosen pending operation of a user reviewer (Reviewers Req 2.1, 2.8)', async () => {
      const reviewerId = newObjectId();
      const created = await createProposal({
        reviewers: [reviewerRef('user', reviewerId)],
      });
      const [chosen, other] = created.operations.map((op) => op.key);
      const now = new Date();
      const token = randomUUID();

      const result = await approveAs(
        created._id,
        identityOf(reviewerId),
        [chosen],
        { channel: 'api', token, now },
      );

      expect(result).toStrictEqual({ ok: true });
      expect(await approvalFieldsOf(created._id, chosen)).toStrictEqual({
        approvedAt: now,
        approvedBy: reviewerId,
        approvedChannel: 'api',
        decisionToken: token,
      });
      expect(await approvalFieldsOf(created._id, other)).toStrictEqual(
        noApproval,
      );
    });

    it('writes the approval of a member of a reviewer user group or external user group (Reviewers Req 2.4)', async () => {
      const userGroupId = newObjectId();
      const externalGroupId = newObjectId();
      const created = await createProposal({
        reviewers: [
          reviewerRef('user-group', userGroupId),
          reviewerRef('external-user-group', externalGroupId),
        ],
      });
      const [first, second] = created.operations.map((op) => op.key);
      const userGroupMember = newObjectId();
      const externalGroupMember = newObjectId();

      const byUserGroup = await approveAs(
        created._id,
        identityOf(userGroupMember, { userGroupIds: [userGroupId] }),
        [first],
      );
      const byExternalGroup = await approveAs(
        created._id,
        identityOf(externalGroupMember, {
          externalUserGroupIds: [externalGroupId],
        }),
        [second],
      );

      expect(byUserGroup).toStrictEqual({ ok: true });
      expect(byExternalGroup).toStrictEqual({ ok: true });
      expect((await approvalFieldsOf(created._id, first)).approvedBy).toBe(
        userGroupMember,
      );
      expect((await approvalFieldsOf(created._id, second)).approvedBy).toBe(
        externalGroupMember,
      );
    });

    it('writes the approval of the requester even when only other people are reviewers (Reviewers Req 2.3)', async () => {
      const requester = newRequester();
      const created = await createProposal({
        requester,
        reviewers: [reviewerRef('user', newObjectId())],
      });
      const key = created.operations[0].key;

      const result = await approveAs(created._id, identityOf(requester), [key]);

      expect(result).toStrictEqual({ ok: true });
      expect((await approvalFieldsOf(created._id, key)).approvedBy).toBe(
        requester,
      );
    });

    it('writes nothing for a user who is neither the requester nor a reviewer, and answers not-found (Reviewers Req 2.7)', async () => {
      const groupId = newObjectId();
      const created = await createProposal({
        reviewers: [
          reviewerRef('user', newObjectId()),
          reviewerRef('user-group', groupId),
        ],
      });
      const key = created.operations[0].key;
      // The group id is held only as an external group, so the kind does not match.
      const outsider = identityOf(newObjectId(), {
        externalUserGroupIds: [groupId],
      });

      const result = await approveAs(created._id, outsider, [key]);

      expect(result).toStrictEqual({ ok: false, code: 'not-found' });
      expect(await approvalFieldsOf(created._id, key)).toStrictEqual(
        noApproval,
      );
    });

    it('answers not-found to a reviewer removed just before the write, and writes nothing (Reviewers Req 2.7)', async () => {
      const removedReviewer = newObjectId();
      const created = await createProposal({
        reviewers: [
          reviewerRef('user', newObjectId()),
          reviewerRef('user', removedReviewer, new Date()),
        ],
      });
      const key = created.operations[0].key;

      const result = await approveAs(created._id, identityOf(removedReviewer), [
        key,
      ]);

      expect(result).toStrictEqual({ ok: false, code: 'not-found' });
      expect(await approvalFieldsOf(created._id, key)).toStrictEqual(
        noApproval,
      );
    });

    it('answers not-found for a missing or malformed proposal id', async () => {
      const approver = identityOf(newObjectId());

      expect(await approveAs(newObjectId(), approver, ['k'])).toStrictEqual({
        ok: false,
        code: 'not-found',
      });
      expect(await approveAs('not-an-id', approver, ['k'])).toStrictEqual({
        ok: false,
        code: 'not-found',
      });
    });

    it('answers not-open to a reviewer and to the requester on a closed proposal (Reviewers Req 2.9)', async () => {
      const reviewerId = newObjectId();
      const created = await createProposal({
        reviewers: [reviewerRef('user', reviewerId)],
      });
      const key = created.operations[0].key;
      await prisma.changeproposals.closeIfStillOpen(
        created._id,
        'withdrawn',
        new Date(),
      );

      const byReviewer = await approveAs(created._id, identityOf(reviewerId), [
        key,
      ]);
      const byRequester = await approveAs(
        created._id,
        identityOf(created.requester),
        [key],
      );

      expect(byReviewer).toStrictEqual({ ok: false, code: 'not-open' });
      expect(byRequester).toStrictEqual({ ok: false, code: 'not-open' });
      expect(await approvalFieldsOf(created._id, key)).toStrictEqual(
        noApproval,
      );
    });

    it('keeps the first approval when another reviewer approves the same operation later (Reviewers Req 2.5)', async () => {
      const first = newObjectId();
      const second = newObjectId();
      const created = await createProposal({
        reviewers: [reviewerRef('user', first), reviewerRef('user', second)],
      });
      const key = created.operations[0].key;
      const firstAt = new Date(Date.now() - 1000);
      const firstToken = randomUUID();
      await approveAs(created._id, identityOf(first), [key], {
        channel: 'ui',
        token: firstToken,
        now: firstAt,
      });

      const later = await approveAs(created._id, identityOf(second), [key], {
        channel: 'api',
        token: randomUUID(),
      });

      expect(later).toStrictEqual({ ok: true });
      expect(await approvalFieldsOf(created._id, key)).toStrictEqual({
        approvedAt: firstAt,
        approvedBy: first,
        approvedChannel: 'ui',
        decisionToken: firstToken,
      });
    });

    it(
      'writes the approval of exactly one of many concurrent group members (Reviewers Req 2.5)',
      async () => {
        for (let round = 0; round < ROUNDS; round++) {
          const groupId = newObjectId();
          const created = await createProposal({
            reviewers: [reviewerRef('user-group', groupId)],
          });
          const key = created.operations[0].key;
          const members = Array.from({ length: CONCURRENCY }, () => ({
            userId: newObjectId(),
            token: randomUUID(),
          }));

          await Promise.all(
            members.map((member) =>
              approveAs(
                created._id,
                identityOf(member.userId, { userGroupIds: [groupId] }),
                [key],
                { token: member.token },
              ),
            ),
          );

          const written = await approvalFieldsOf(created._id, key);
          const winner = members.find((m) => m.token === written.decisionToken);
          expect(winner).toBeDefined();
          expect(written.approvedBy).toBe(winner?.userId);
        }
      },
      CONCURRENCY_TIMEOUT_MS,
    );

    it('lets another reviewer approve again after the operation went back to waiting (Reviewers Req 2.10)', async () => {
      const first = newObjectId();
      const second = newObjectId();
      const created = await createProposal({
        operations: [editOp()],
        reviewers: [reviewerRef('user', first), reviewerRef('user', second)],
      });
      const key = created.operations[0].key;
      await approveAs(created._id, identityOf(first), [key]);
      const lease = randomUUID();
      await prisma.changeproposals.claimApplyLease(
        created._id,
        lease,
        new Date(),
      );
      await prisma.changeproposals.recordOperationOutcome(
        created._id,
        lease,
        key,
        { status: 'pending', reason: 'page-being-edited' },
        new Date(),
      );
      await prisma.changeproposals.releaseApplyLease(created._id, lease);
      const now = new Date();
      const token = randomUUID();

      const result = await approveAs(created._id, identityOf(second), [key], {
        channel: 'ai-tool',
        token,
        now,
      });

      expect(result).toStrictEqual({ ok: true });
      expect(await approvalFieldsOf(created._id, key)).toStrictEqual({
        approvedAt: now,
        approvedBy: second,
        approvedChannel: 'ai-tool',
        decisionToken: token,
      });
    });

    it('writes no approver, channel or token when auto-apply approves for the requester', async () => {
      const created = await createProposal({ operations: [editOp()] });
      const key = created.operations[0].key;
      const now = new Date();

      const result = await prisma.changeproposals.markApproved(
        created._id,
        created.requester,
        [key],
        now,
      );

      expect(result).toStrictEqual({ ok: true });
      expect(await approvalFieldsOf(created._id, key)).toStrictEqual({
        ...noApproval,
        approvedAt: now,
      });
    });
  });

  describe('adding and removing reviewers', () => {
    const activeEntriesOf = async (id: string) => {
      const read = await prisma.changeproposals.findProposal(id);
      return (read?.reviewers ?? []).filter((r) => r.removedAt == null);
    };

    it('adds users, user groups and external user groups with who added them and when (Reviewers Req 4.1, 4.2, 4.10)', async () => {
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

    it('lets an active reviewer, including a group member, add a reviewer (Reviewers Req 4.1)', async () => {
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

    it('changes nothing and reports nothing added for a reviewer who is already active (Reviewers Req 4.6)', async () => {
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

    it('treats the same id under another kind as a different reviewer (Reviewers Req 4.6)', async () => {
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

    it('marks a removed reviewer with who removed them and when, and keeps the entry (Reviewers Req 4.3, 4.10)', async () => {
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

    it('lets a reviewer remove themselves (Reviewers Req 4.3)', async () => {
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

    it('changes nothing when the reviewer to remove is not an active reviewer (Reviewers Req 4.7)', async () => {
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

    it('adds a new entry for a removed reviewer added back, and a later removal leaves the old record as it was (Reviewers Req 4.10)', async () => {
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

    it('keeps the approvals, rejections and abstentions of a removed reviewer (Reviewers Req 4.12)', async () => {
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

    it('accepts a malformed reviewer id to remove and changes nothing (Reviewers Req 4.7)', async () => {
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

    it('answers not-open and changes nothing on a closed proposal (Reviewers Req 4.8)', async () => {
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

    it('answers not-found and changes nothing for someone who is neither the requester nor a reviewer (Reviewers Req 2.7)', async () => {
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
      'keeps every reviewer added concurrently by different people (Reviewers Req 4.1)',
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
      'adds the same reviewer only once when many people add them concurrently (Reviewers Req 4.6)',
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

    it('records a rejection of each chosen operation with who, when, the comment and the channel (Reviewers Req 3.1)', async () => {
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

    it('records a rejection of the whole proposal without an operation key (Reviewers Req 3.2)', async () => {
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

    it('records an abstention of a chosen operation (Reviewers Req 3.3)', async () => {
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

    it('leaves the status and approval of every operation and the lifecycle as they were (Reviewers Req 3.9)', async () => {
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

    it('replaces the same person’s earlier record of the same operation, and leaves other records alone (Reviewers Req 3.4)', async () => {
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

    it('replaces the same person’s earlier whole rejection, and keeps their records of operations (Reviewers Req 3.4)', async () => {
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

    it('answers not-found and records nothing for someone who is not a reviewer (Reviewers Req 3.11)', async () => {
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

    it('answers not-open and records nothing on a closed proposal (Reviewers Req 2.9)', async () => {
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

      it('answers not-open and keeps the earlier record when the proposal has closed (Reviewers Req 3.4, 2.9)', async () => {
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

      it('answers not-found and keeps the earlier record when the reviewer has been removed (Reviewers Req 3.4, 4.12)', async () => {
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
        'never loses both records when the proposal closes during the replacement (Reviewers Req 3.4)',
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
        'never loses both records when the reviewer is removed during the replacement (Reviewers Req 3.4, 4.12)',
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

      it('removes the approver’s records of the approved operations, and keeps their whole rejection and others’ records (Reviewers Req 3.4)', async () => {
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

      it('also removes the approver’s whole rejection when the whole proposal is approved (Reviewers Req 3.4)', async () => {
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

      it('removes the approver’s records even after the approval closed the proposal (Reviewers Req 3.4)', async () => {
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
