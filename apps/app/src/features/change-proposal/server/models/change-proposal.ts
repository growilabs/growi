import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';
import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import { getOrCreateModel } from '~/server/util/mongoose-utils';
import type { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  OperationStatus,
  ProposalMark,
  ReviewerInput,
  SkipReason,
} from '../../interfaces';
import type { ViewerIdentity } from '../domain';
import {
  approverWhere,
  closableWhere,
  hasPendingOperation,
  idNotIn,
  interruptedApplyWhere,
  leaseFreeAt,
  PENDING,
  REVERT_ENTRY,
  SETTLED,
  settleableWhere,
  summarySelect,
  toApprovalData,
  toLinkedProposalRecord,
  toOperationCreateInput,
  toOriginalOperationData,
  toOutcomeData,
  toRequesterWriteMiss,
  toReviewerWriteMiss,
  UNSET_APPROVAL,
  unapprovedOperation,
  withoutUndefined,
} from './change-proposal-query-parts';
import { listReviewQueueAfter } from './change-proposal-review-queue';
import {
  addReviewers,
  addReviews,
  clearReviewsOnApproval,
  removeReviewers,
} from './change-proposal-reviewer-writes';
import type {
  AddReviewersResult,
  AppliedListCursor,
  AttributedApproval,
  ClosingLifecycle,
  CreateProposalInput,
  LinkedProposalRecord,
  OriginalOperationChange,
  RecordedOutcome,
  RequesterWriteResult,
  ReviewEntry,
} from './change-proposal-types';
import { runConditionalWrite } from './conditional-write';
import {
  type ChangeProposalSummary,
  toChangeProposalDocument,
  toChangeProposalSummary,
} from './to-change-proposal-document';

export const APPLY_LEASE_MS = 5 * 60 * 1000;
export const LINKED_PROPOSALS_LIMIT = 50;

// Prisma does every read and write. The mongoose model exists only so that
// notifications and activities can populate it as their targetModel.
getOrCreateModel('ChangeProposal', new Schema({}));

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
              purpose: input.purpose,
              reviewers: (input.reviewers ?? []).map((r) => ({ ...r })),
              reviews: [],
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

        /**
         * Approves the chosen pending, not-yet-approved operations. A requester id alone
         * (auto-apply) records no approver. `ok` means only that the proposal matched, not
         * that an operation was written: the caller re-reads the operations carrying its
         * decisionToken to learn which ones this request approved.
         */
        async markApproved(
          id: string,
          approver: string | AttributedApproval,
          keys: readonly string[],
          now: Date,
        ): Promise<RequesterWriteResult> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const approverId =
            typeof approver === 'string' ? approver : approver.approver.userId;
          const written =
            isValidObjectId(id) &&
            isValidObjectId(approverId) &&
            (await runConditionalWrite(() =>
              context.updateMany({
                where: { id, lifecycle: 'open', ...approverWhere(approver) },
                data: {
                  operations: {
                    updateMany: {
                      where: {
                        key: { in: [...keys] },
                        status: PENDING,
                        ...unapprovedOperation,
                      },
                      data: toApprovalData(now, approver),
                    },
                  },
                },
              }),
            ));
          if (written) {
            return { ok: true };
          }
          if (typeof approver === 'string') {
            return explainRequesterWriteMiss(
              (pid) =>
                context.findUnique({
                  where: { id: pid },
                  select: { requester: true },
                }),
              id,
              approver,
            );
          }
          return toReviewerWriteMiss(
            isValidObjectId(id) && isValidObjectId(approverId)
              ? await context.findUnique({
                  where: { id },
                  select: { requester: true, reviewers: true },
                })
              : null,
            approver.approver,
          );
        },

        /**
         * Adds each reviewer with its own conditional push, so concurrent adds never drop
         * one another and a reviewer is never active twice. `added` lists only the
         * reviewers this call made active.
         */
        addReviewers(
          id: string,
          actor: ViewerIdentity,
          inputs: readonly ReviewerInput[],
          now: Date,
        ): Promise<AddReviewersResult> {
          return addReviewers(
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this),
            id,
            actor,
            inputs,
            now,
          );
        },

        /** Marks the matching active reviewers as removed; the entries stay as a record. */
        removeReviewers(
          id: string,
          actor: ViewerIdentity,
          inputs: readonly ReviewerInput[],
          now: Date,
        ): Promise<RequesterWriteResult> {
          return removeReviewers(
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this),
            id,
            actor,
            inputs,
            now,
          );
        },

        /**
         * Records a reviewer's reject or abstain, replacing the same reviewer's earlier
         * record of the same operations (or of the whole proposal). Operations are left as
         * they are: a rejection never stops an approval.
         */
        addReviews(
          id: string,
          reviewer: ViewerIdentity,
          entry: ReviewEntry,
          now: Date,
        ): Promise<RequesterWriteResult> {
          return addReviews(
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this),
            id,
            reviewer,
            entry,
            now,
          );
        },

        /**
         * Drops the approver's reject and abstain records of the approved operations, and with
         * `wholeProposal` their whole rejection too. Not limited to open proposals: the apply
         * that follows an approval may already have settled the proposal.
         */
        clearReviewsOnApproval(
          id: string,
          approverId: string,
          operationKeys: readonly string[],
          options: { readonly wholeProposal: boolean },
        ): Promise<boolean> {
          return clearReviewsOnApproval(
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this),
            id,
            approverId,
            operationKeys,
            options.wholeProposal,
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
                        ...UNSET_APPROVAL,
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
                      ...UNSET_APPROVAL,
                    },
                  },
                },
              },
            }),
          );
        },

        async findIdsDueForExpiry(
          now: Date,
          limit: number,
          excludeIds: readonly string[] = [],
        ): Promise<string[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: { ...closableWhere('expired', now), ...idNotIn(excludeIds) },
            select: { id: true },
            take: limit,
          });
          return rows.map((row) => row.id);
        },

        async findIdsOpenForWithdraw(
          now: Date,
          limit: number,
          excludeIds: readonly string[] = [],
        ): Promise<string[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: {
              ...closableWhere('withdrawn', now),
              ...idNotIn(excludeIds),
            },
            select: { id: true },
            take: limit,
          });
          return rows.map((row) => row.id);
        },

        async findIdsWithInterruptedApply(
          now: Date,
          limit: number,
          excludeIds: readonly string[] = [],
        ): Promise<string[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: { ...interruptedApplyWhere(now), ...idNotIn(excludeIds) },
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

        async findIdsOpenWithoutPending(
          limit: number,
          excludeIds: readonly string[] = [],
        ): Promise<string[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this);
          const rows = await context.findMany({
            where: { ...settleableWhere, ...idNotIn(excludeIds) },
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
              reviewers: true,
              operations: {
                select: {
                  key: true,
                  type: true,
                  status: true,
                  pageId: true,
                  path: true,
                  toPath: true,
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

        /** Open proposals with an active reviewer entry for the viewer or a group of theirs, by `_id` after `afterId`. */
        listReviewQueueAfter(
          viewer: ViewerIdentity,
          afterId: string | null,
          take: number,
        ): Promise<ChangeProposalSummary[]> {
          return listReviewQueueAfter(
            Prisma.getExtensionContext<typeof prisma.changeproposals>(this),
            viewer,
            afterId,
            take,
          );
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
