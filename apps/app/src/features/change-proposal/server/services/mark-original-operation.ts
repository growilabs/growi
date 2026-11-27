import { prisma } from '~/utils/prisma';

import type { ProposalMark } from '../../interfaces';
import type { OriginalOperationChange } from '../models/change-proposal-types';
import { retryOnError } from './retry-on-error';

const MARK_RETRIES = 2;
const MARK_RETRY_DELAY_MS = 150;

export type WriteOriginalMark = (
  proposalId: string,
  operationKey: string,
  change: OriginalOperationChange,
) => Promise<boolean>;

export const writeOriginalMarkToDb: WriteOriginalMark = (
  proposalId,
  operationKey,
  change,
) =>
  prisma.changeproposals.markOriginalOperation(
    proposalId,
    operationKey,
    change,
  );

export const waitBeforeMarkRetry = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, MARK_RETRY_DELAY_MS);
  });

export type OriginalMarkDeps = {
  readonly write: WriteOriginalMark;
  readonly wait: () => Promise<void>;
};

// Resolves false when the original is no longer revertible (never retried);
// rejects only after every attempt threw.
export const markOriginalOperationWithRetry = (
  target: ProposalMark,
  change: OriginalOperationChange,
  { write, wait }: OriginalMarkDeps,
): Promise<boolean> =>
  retryOnError(() => write(target.proposalId, target.operationKey, change), {
    retries: MARK_RETRIES,
    wait,
  });
