import type { IUserHasId } from '@growi/core';

import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { ApplyResult, ApplyTrigger } from '../../interfaces';
import { expandApprovalTargets } from '../domain';
import type { RequesterWriteResult } from '../models/change-proposal-types';
import type {
  ApprovalTargets,
  ServiceError,
  ServiceResult,
} from './change-proposal-service-types';
import type { ProposalApplier } from './proposal-applier';

const logger = loggerFactory(
  'growi:features:change-proposal:services:requester-actions',
);

// The requester's own actions on an open proposal. Anyone else, and any id that
// names no proposal, gets the same not-found so existence never leaks.
export type RequesterActions = {
  approve(
    proposalId: string,
    user: IUserHasId,
    targets: ApprovalTargets,
    trigger: ApplyTrigger,
  ): Promise<ServiceResult<ApplyResult>>;
  skip(
    proposalId: string,
    user: IUserHasId,
    keys: readonly string[],
  ): Promise<ServiceResult<void>>;
  discard(proposalId: string, user: IUserHasId): Promise<ServiceResult<void>>;
  setPerPageNotifications(
    proposalId: string,
    user: IUserHasId,
    value: boolean,
  ): Promise<ServiceResult<void>>;
};

const NOT_FOUND: ServiceError = { code: 'not-found' };

const fail = (error: ServiceError): { ok: false; error: ServiceError } => ({
  ok: false,
  error,
});

const requesterIdOf = (user: IUserHasId | null | undefined): string | null =>
  user?._id == null ? null : user._id.toString();

const stringKeys = (keys: readonly unknown[]): string[] =>
  keys.filter((key): key is string => typeof key === 'string');

const toVoidResult = (written: RequesterWriteResult): ServiceResult<void> =>
  written.ok ? { ok: true, value: undefined } : fail({ code: written.code });

export const createRequesterActions = (deps: {
  readonly applier: ProposalApplier;
  readonly now: () => Date;
}): RequesterActions => {
  const { applier, now } = deps;

  // Keys of the pending operations the approval covers, read from the requester's
  // own proposal; null when the caller may not know the proposal exists.
  const resolveApprovalKeys = async (
    proposalId: string,
    requesterId: string,
    targets: ApprovalTargets,
  ): Promise<string[] | null> => {
    const proposal = await prisma.changeproposals.findProposal(proposalId);
    if (proposal == null || proposal.requester !== requesterId) {
      return null;
    }
    const chosenKeys = new Set(targets === 'all' ? [] : stringKeys(targets));
    const chosen =
      targets === 'all'
        ? 'all'
        : proposal.operations
            .filter((op) => chosenKeys.has(op.key))
            .map((op) => op.index);
    const indices = new Set(expandApprovalTargets(proposal.operations, chosen));
    return proposal.operations
      .filter((op) => indices.has(op.index))
      .map((op) => op.key);
  };

  return {
    async approve(proposalId, user, targets, trigger) {
      const requesterId = requesterIdOf(user);
      if (
        requesterId == null ||
        (targets !== 'all' && !Array.isArray(targets))
      ) {
        return fail(NOT_FOUND);
      }
      const keys = await resolveApprovalKeys(proposalId, requesterId, targets);
      if (keys == null) {
        return fail(NOT_FOUND);
      }
      // The conditional write, not the read above, decides whether the proposal is still open.
      const approved = await prisma.changeproposals.markApproved(
        proposalId,
        requesterId,
        keys,
        now(),
      );
      if (!approved.ok) {
        return fail({ code: approved.code });
      }

      try {
        return {
          ok: true,
          value: await applier.apply(proposalId, trigger),
        };
      } catch (err) {
        // The approvals are saved, so the maintenance cron resumes the apply.
        logger.error(
          { err, proposalId },
          'Applying approved operations failed',
        );
        return { ok: true, value: { type: 'in-progress' } };
      }
    },

    async skip(proposalId, user, keys) {
      const requesterId = requesterIdOf(user);
      if (requesterId == null || !Array.isArray(keys)) {
        return fail(NOT_FOUND);
      }
      const skipped = await prisma.changeproposals.skipPendingOperations(
        proposalId,
        requesterId,
        stringKeys(keys),
      );
      if (skipped.ok) {
        await prisma.changeproposals.settleIfNoPending(proposalId);
      }
      return toVoidResult(skipped);
    },

    async discard(proposalId, user) {
      const requesterId = requesterIdOf(user);
      if (requesterId == null) {
        return fail(NOT_FOUND);
      }
      // The model settles an open proposal with nothing pending before answering not-open.
      return toVoidResult(
        await prisma.changeproposals.skipPendingOperations(
          proposalId,
          requesterId,
          'all-pending',
          'discarded',
        ),
      );
    },

    async setPerPageNotifications(proposalId, user, value) {
      const requesterId = requesterIdOf(user);
      if (requesterId == null || typeof value !== 'boolean') {
        return fail(NOT_FOUND);
      }
      return toVoidResult(
        await prisma.changeproposals.setPerPageNotifications(
          proposalId,
          requesterId,
          value,
        ),
      );
    },
  };
};
