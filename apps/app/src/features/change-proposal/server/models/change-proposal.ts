import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';
import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import { getOrCreateModel } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';
import type { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  OperationStatus,
  ProposalMark,
  SkipReason,
} from '../../interfaces';
import {
  closableWhere,
  hasPendingOperation,
  interruptedApplyWhere,
  leaseFreeAt,
  PENDING,
  REVERT_ENTRY,
  SETTLED,
  settleableWhere,
  summarySelect,
  toLinkedProposalRecord,
  toOperationCreateInput,
  toOriginalOperationData,
  toOutcomeData,
  toRequesterWriteMiss,
  withoutUndefined,
} from './change-proposal-query-parts';
import type {
  AppliedListCursor,
  ClosingLifecycle,
  CreateProposalInput,
  LinkedProposalRecord,
  OriginalOperationChange,
  RecordedOutcome,
  RequesterWriteResult,
} from './change-proposal-types';
import {
  type ChangeProposalSummary,
  toChangeProposalDocument,
  toChangeProposalSummary,
} from './to-change-proposal-document';

const logger = loggerFactory('growi:features:change-proposal:models');

export const APPLY_LEASE_MS = 5 * 60 * 1000;
export const LINKED_PROPOSALS_LIMIT = 50;

// Only the indexed paths: Prisma does every read and write, while mongoose creates the
// collection and its (partly sparse) indexes, which schema.prisma cannot express.
// The model name is also the targetModel that notifications and activities populate.
const schema = new Schema({
  requester: { type: Schema.Types.ObjectId },
  createdAt: { type: Date },
  lifecycle: { type: String },
  expiresAt: { type: Date },
  applyLease: { expiresAt: { type: Date } },
  lastAppliedAt: { type: Date },
  revertOf: { type: Schema.Types.ObjectId },
  basedOn: { proposalId: { type: Schema.Types.ObjectId } },
});
schema.index({ requester: 1, createdAt: -1 });
schema.index({ lifecycle: 1, expiresAt: 1 });
schema.index({ 'applyLease.expiresAt': 1 }, { sparse: true });
schema.index({ lastAppliedAt: -1 }, { sparse: true });
schema.index({ revertOf: 1 }, { sparse: true });
schema.index({ 'basedOn.proposalId': 1 }, { sparse: true });

getOrCreateModel('ChangeProposal', schema);

// P2034 is the query engine giving up after repeated write conflicts; the caller did not write.
const runConditionalWrite = async (
  write: () => Promise<{ count: number }>,
): Promise<boolean> => {
  try {
    const { count } = await write();
    return count > 0;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2034'
    ) {
      logger.warn(
        `Conditional write gave up after write conflicts: ${err.message}`,
      );
      return false;
    }
    throw err;
  }
};

type RequesterReader = (
  id: string,
) => Promise<{ readonly requester: string } | null>;

const explainRequesterWriteMiss = async (
  readRequester: RequesterReader,
  id: string,
  requesterId: string,
): Promise<RequesterWriteResult> =>
  toRequesterWriteMiss(
    isValidObjectId(id) ? await readRequester(id) : null,
    requesterId,
  );

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      changeproposals: {
        // for backward compatibility with mongoose
        _id: {
          needs: { id: true },
          compute(model) {
            return model.id;
          },
        },
        // for backward compatibility with mongoose
        __v: {
          needs: { v: true },
          compute(model) {
            return model.v;
          },
        },
      },
    },
    model: {
      changeproposals: {
        async createProposal(
          input: CreateProposalInput,
        ): Promise<ChangeProposalDocument> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const created = await context.create({
            data: withoutUndefined({
              requester: input.requester,
              entry: input.entry,
              modelLabel: input.modelLabel,
              revertOf: input.revertOf,
              basedOn:
                input.basedOn == null
                  ? undefined
                  : {
                      proposalId: input.basedOn.proposalId,
                      relation: input.basedOn.relation,
                      operationKeys: [...input.basedOn.operationKeys],
                    },
              lifecycle: 'open',
              operations: input.operations.map(toOperationCreateInput),
              appliedPageIds: [],
              expiresAt: input.expiresAt,
              perPageNotifications: input.perPageNotifications,
            }),
          });
          return toChangeProposalDocument(created);
        },

        async findProposal(id: string): Promise<ChangeProposalDocument | null> {
          if (!isValidObjectId(id)) {
            return null;
          }
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const row = await context.findUnique({ where: { id } });
          return row == null ? null : toChangeProposalDocument(row);
        },

        async setPerPageNotifications(
          id: string,
          requesterId: string,
          value: boolean,
        ): Promise<RequesterWriteResult> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const written =
            isValidObjectId(id) &&
            isValidObjectId(requesterId) &&
            (await runConditionalWrite(() =>
              context.updateMany({
                where: { id, requester: requesterId, lifecycle: 'open' },
                data: { perPageNotifications: value },
              }),
            ));
          return written
            ? { ok: true }
            : explainRequesterWriteMiss(
                (pid) =>
                  context.findUnique({
                    where: { id: pid },
                    select: { requester: true },
                  }),
                id,
                requesterId,
              );
        },

        async readPerPageNotifications(id: string): Promise<boolean | null> {
          if (!isValidObjectId(id)) {
            return null;
          }
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const row = await context.findUnique({
            where: { id },
            select: { perPageNotifications: true },
          });
          return row?.perPageNotifications ?? null;
        },

        claimApplyLease(
          id: string,
          token: string,
          now: Date,
        ): Promise<boolean> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          return runConditionalWrite(() =>
            context.updateMany({
              where: { id, ...leaseFreeAt(now) },
              data: {
                applyLease: {
                  set: {
                    token,
                    expiresAt: new Date(now.getTime() + APPLY_LEASE_MS),
                  },
                },
              },
            }),
          );
        },

        extendApplyLease(
          id: string,
          token: string,
          now: Date,
        ): Promise<boolean> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          return runConditionalWrite(() =>
            context.updateMany({
              where: { id, applyLease: { is: { token } } },
              data: {
                applyLease: {
                  set: {
                    token,
                    expiresAt: new Date(now.getTime() + APPLY_LEASE_MS),
                  },
                },
              },
            }),
          );
        },

        releaseApplyLease(id: string, token: string): Promise<boolean> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          return runConditionalWrite(() =>
            context.updateMany({
              where: { id, applyLease: { is: { token } } },
              data: { applyLease: { unset: true } },
            }),
          );
        },

        async markApproved(
          id: string,
          requesterId: string,
          keys: readonly string[],
          now: Date,
        ): Promise<RequesterWriteResult> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const written =
            isValidObjectId(id) &&
            isValidObjectId(requesterId) &&
            (await runConditionalWrite(() =>
              context.updateMany({
                where: { id, requester: requesterId, lifecycle: 'open' },
                data: {
                  operations: {
                    updateMany: {
                      where: { key: { in: [...keys] }, status: PENDING },
                      data: { approvedAt: now },
                    },
                  },
                },
              }),
            ));
          return written
            ? { ok: true }
            : explainRequesterWriteMiss(
                (pid) =>
                  context.findUnique({
                    where: { id: pid },
                    select: { requester: true },
                  }),
                id,
                requesterId,
              );
        },

        /**
         * Skips the requester's chosen pending operations, or with `closing` discards the
         * proposal by skipping all of them in the same write. The caller settles after a skip.
         */
        async skipPendingOperations(
          id: string,
          requesterId: string,
          keys: readonly string[] | 'all-pending',
          closing?: 'discarded',
        ): Promise<RequesterWriteResult> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const reason: SkipReason = closing ?? 'skipped-by-requester';
          const written =
            isValidObjectId(id) &&
            isValidObjectId(requesterId) &&
            (await runConditionalWrite(() =>
              context.updateMany({
                where: {
                  id,
                  requester: requesterId,
                  lifecycle: 'open',
                  ...(closing == null ? {} : hasPendingOperation),
                },
                data: {
                  ...(closing == null ? {} : { lifecycle: closing }),
                  operations: {
                    updateMany: {
                      where: {
                        status: PENDING,
                        ...(keys === 'all-pending'
                          ? {}
                          : { key: { in: [...keys] } }),
                      },
                      data: {
                        status: 'skipped',
                        reason,
                        approvedAt: { unset: true },
                      },
                    },
                  },
                },
              }),
            ));
          if (written) {
            return { ok: true };
          }
          const miss = await explainRequesterWriteMiss(
            (pid) =>
              context.findUnique({
                where: { id: pid },
                select: { requester: true },
              }),
            id,
            requesterId,
          );
          if (closing != null && !miss.ok && miss.code === 'not-open') {
            // An open proposal with nothing pending was stopped before its settle write.
            await context.settleIfNoPending(id);
          }
          return miss;
        },

        async recordOperationOutcome(
          id: string,
          token: string,
          key: string,
          outcome: RecordedOutcome,
          now: Date,
        ): Promise<boolean> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);

          let appliedData: Prisma.changeproposalsUpdateManyMutationInput = {};
          if (outcome.status === 'applied') {
            // Only the lease holder writes appliedPageIds, so read-then-push does not race.
            const current = await context.findUnique({
              where: { id },
              select: { appliedPageIds: true },
            });
            const isNewPage = !(current?.appliedPageIds ?? []).includes(
              outcome.resultPageId,
            );
            appliedData = {
              lastAppliedAt: now,
              ...(isNewPage
                ? { appliedPageIds: { push: outcome.resultPageId } }
                : {}),
            };
          }

          return runConditionalWrite(() =>
            context.updateMany({
              where: {
                id,
                applyLease: { is: { token } },
                operations: { some: { key, status: PENDING } },
              },
              data: {
                ...appliedData,
                operations: {
                  updateMany: {
                    where: { key, status: PENDING },
                    data: toOutcomeData(outcome, now),
                  },
                },
              },
            }),
          );
        },

        markOriginalOperation(
          id: string,
          key: string,
          change: OriginalOperationChange,
        ): Promise<boolean> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const revertible: OperationStatus[] = ['applied', 'revert-refused'];
          return runConditionalWrite(() =>
            context.updateMany({
              where: {
                id,
                operations: { some: { key, status: { in: revertible } } },
              },
              data: {
                operations: {
                  updateMany: {
                    where: { key, status: { in: revertible } },
                    data: toOriginalOperationData(change),
                  },
                },
              },
            }),
          );
        },

        closeIfStillOpen(
          id: string,
          closing: ClosingLifecycle,
          now: Date,
        ): Promise<boolean> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          return runConditionalWrite(() =>
            context.updateMany({
              where: { id, ...closableWhere(closing, now) },
              data: {
                lifecycle: closing,
                operations: {
                  updateMany: {
                    where: { status: PENDING },
                    data: {
                      status: 'skipped',
                      reason: closing,
                      approvedAt: { unset: true },
                    },
                  },
                },
              },
            }),
          );
        },

        async findIdsDueForExpiry(now: Date, limit: number): Promise<string[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: closableWhere('expired', now),
            select: { id: true },
            take: limit,
          });
          return rows.map((row) => row.id);
        },

        async findIdsOpenForWithdraw(
          now: Date,
          limit: number,
        ): Promise<string[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: closableWhere('withdrawn', now),
            select: { id: true },
            take: limit,
          });
          return rows.map((row) => row.id);
        },

        async findIdsWithInterruptedApply(
          now: Date,
          limit: number,
        ): Promise<string[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: interruptedApplyWhere(now),
            select: { id: true },
            take: limit,
          });
          return rows.map((row) => row.id);
        },

        settleIfNoPending(id: string): Promise<boolean> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          return runConditionalWrite(() =>
            context.updateMany({
              where: { id, ...settleableWhere },
              data: { lifecycle: SETTLED },
            }),
          );
        },

        async findIdsOpenWithoutPending(limit: number): Promise<string[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: settleableWhere,
            select: { id: true },
            take: limit,
          });
          return rows.map((row) => row.id);
        },

        async findLinkedProposals(
          baseId: string,
          limit: number = LINKED_PROPOSALS_LIMIT,
        ): Promise<LinkedProposalRecord[]> {
          if (!isValidObjectId(baseId)) {
            return [];
          }
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: { basedOn: { is: { proposalId: baseId } } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit,
            select: {
              id: true,
              requester: true,
              entry: true,
              basedOn: true,
              operations: {
                select: {
                  key: true,
                  type: true,
                  status: true,
                  pageId: true,
                  resultPageId: true,
                },
              },
            },
          });
          return rows.map(toLinkedProposalRecord);
        },

        countCreatedSince(requesterId: string, since: Date): Promise<number> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          return context.count({
            where: {
              requester: requesterId,
              createdAt: { gte: since },
              entry: { not: REVERT_ENTRY },
            },
          });
        },

        async listByRequester(
          requesterId: string,
          paging: { readonly skip: number; readonly take: number },
        ): Promise<ChangeProposalSummary[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: { requester: requesterId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: paging.skip,
            take: paging.take,
            select: summarySelect,
          });
          return rows.map(toChangeProposalSummary);
        },

        async listAppliedAfterCursor(
          cursor: AppliedListCursor | null,
          take: number,
        ): Promise<ChangeProposalSummary[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: {
              appliedPageIds: { isEmpty: false },
              lastAppliedAt: { not: null },
              ...(cursor == null
                ? {}
                : {
                    OR: [
                      { lastAppliedAt: { lt: cursor.lastAppliedAt } },
                      {
                        lastAppliedAt: cursor.lastAppliedAt,
                        id: { lt: cursor.id },
                      },
                    ],
                  }),
            },
            orderBy: [{ lastAppliedAt: 'desc' }, { id: 'desc' }],
            take,
            select: summarySelect,
          });
          return rows.map(toChangeProposalSummary);
        },

        /** Reads the proposals the marks point at, keeping only the marked operations. */
        async findOperationsForMarks(
          marks: readonly ProposalMark[],
        ): Promise<ChangeProposalSummary[]> {
          const keysByProposal = new Map<string, Set<string>>();
          for (const mark of marks) {
            if (!isValidObjectId(mark.proposalId)) {
              continue;
            }
            const keys = keysByProposal.get(mark.proposalId) ?? new Set();
            keysByProposal.set(mark.proposalId, keys.add(mark.operationKey));
          }
          if (keysByProposal.size === 0) {
            return [];
          }
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: { id: { in: [...keysByProposal.keys()] } },
            select: summarySelect,
          });
          return rows.map((row) => {
            const keys = keysByProposal.get(row.id);
            return toChangeProposalSummary({
              ...row,
              operations: row.operations.filter((op) => keys?.has(op.key)),
            });
          });
        },
      },
    },
  });
});
