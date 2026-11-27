import type { IUserHasId } from '@growi/core';

import { prisma } from '~/utils/prisma';

import type { RequesterWriteResult } from '../models/change-proposal-types';
import type {
  ServiceError,
  ServiceResult,
} from './change-proposal-service-types';

// The requester's own actions on an open proposal (approving is in reviewer-actions).
// Anyone else, and any id that names no proposal, gets the same not-found so
// existence never leaks.
export type RequesterActions = {
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

export const createRequesterActions = (): RequesterActions => {
  return {
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
