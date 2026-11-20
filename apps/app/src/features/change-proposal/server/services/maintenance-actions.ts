import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { ProposalApplier } from './proposal-applier';

const logger = loggerFactory(
  'growi:features:change-proposal:services:maintenance-actions',
);

export const MAINTENANCE_BATCH_SIZE = 100;
// Bounds one run: every write is conditional, so whatever is left waits for the next run.
const MAX_BATCHES_PER_RUN = 50;

// Closing, resuming and settling proposals nobody is acting on. Every write is the
// model's conditional update, so concurrent runs on several servers and a requester
// acting at the same moment never handle the same proposal twice.
export type MaintenanceActions = {
  expireDueProposals(now: Date): Promise<number>;
  withdrawAllPending(): Promise<number>;
  resumeInterruptedApplies(now: Date): Promise<number>;
  settleStalledProposals(): Promise<number>;
};

// A proposal that could not be handled may keep matching (e.g. its apply throws), so
// the ids tried in this run are excluded from later reads instead of filling every batch.
const handleEachCandidateOnce = async (
  findIds: (excludeIds: readonly string[]) => Promise<readonly string[]>,
  handle: (id: string) => Promise<boolean>,
  task: string,
): Promise<number> => {
  const tried = new Set<string>();
  let handled = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    // biome-ignore lint/performance/noAwaitInLoops: each batch is read after the previous one's writes
    const fresh = (await findIds([...tried])).filter((id) => !tried.has(id));
    if (fresh.length === 0) {
      return handled;
    }
    for (const id of fresh) {
      tried.add(id);
      try {
        // biome-ignore lint/performance/noAwaitInLoops: one proposal at a time keeps the load on the DB and pages flat
        if (await handle(id)) {
          handled += 1;
        }
      } catch (err) {
        logger.error(
          { err, proposalId: id },
          `Change proposal maintenance (${task}) failed for one proposal`,
        );
      }
    }
  }
  return handled;
};

export const createMaintenanceActions = (deps: {
  readonly applier: ProposalApplier;
  readonly now: () => Date;
  readonly batchSize?: number;
}): MaintenanceActions => {
  const { applier, now } = deps;
  const limit = deps.batchSize ?? MAINTENANCE_BATCH_SIZE;

  return {
    expireDueProposals(at) {
      return handleEachCandidateOnce(
        (tried) => prisma.changeproposals.findIdsDueForExpiry(at, limit, tried),
        (id) => prisma.changeproposals.closeIfStillOpen(id, 'expired', at),
        'expire',
      );
    },

    withdrawAllPending() {
      const at = now();
      return handleEachCandidateOnce(
        (tried) =>
          prisma.changeproposals.findIdsOpenForWithdraw(at, limit, tried),
        (id) => prisma.changeproposals.closeIfStillOpen(id, 'withdrawn', at),
        'withdraw',
      );
    },

    resumeInterruptedApplies(at) {
      return handleEachCandidateOnce(
        (tried) =>
          prisma.changeproposals.findIdsWithInterruptedApply(at, limit, tried),
        async (id) =>
          (await applier.apply(id, { kind: 'background' })).type === 'done',
        'resume',
      );
    },

    settleStalledProposals() {
      return handleEachCandidateOnce(
        (tried) =>
          prisma.changeproposals.findIdsOpenWithoutPending(limit, tried),
        (id) => prisma.changeproposals.settleIfNoPending(id),
        'settle',
      );
    },
  };
};
