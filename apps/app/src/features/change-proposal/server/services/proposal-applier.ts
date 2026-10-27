import { randomUUID } from 'node:crypto';
import type { IUserHasId } from '@growi/core';
import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  ApplyResult,
  ApplyTrigger,
  ChangeProposalDocument,
  OperationRecord,
} from '../../interfaces';
import { planApplyOrder, shouldSendPerPageNotifications } from '../domain';
import type { RecordedOutcome } from '../models/change-proposal-types';
import {
  createOperationHandlers,
  type OperationContext,
  type OperationHandler,
  type OperationHandlerTable,
  type OperationOutcome,
} from './operation-handlers';
import { recordProposalActivity } from './proposal-activity';
import {
  createProposalNotifier,
  type ProposalNotifier,
} from './proposal-notifier';
import { readChangeProposalSettings } from './settings';

const logger = loggerFactory(
  'growi:features:change-proposal:services:proposal-applier',
);

export type ApplyRequestParameters = {
  readonly ip?: string;
  readonly endpoint?: string;
};

export type ProposalApplier = {
  apply(
    proposalId: string,
    trigger: ApplyTrigger,
    request?: ApplyRequestParameters,
  ): Promise<ApplyResult>;
};

export type ProposalApplierDeps = {
  readonly handlers?: OperationHandlerTable;
  readonly notifier?: ProposalNotifier;
  readonly now?: () => Date;
};

type OperationResult = Extract<
  ApplyResult,
  { type: 'done' }
>['results'][number];

type AttemptOutcome = {
  readonly outcome: RecordedOutcome;
  // Set only when this run wrote the operation and per-page notifications are due.
  readonly notify?: () => Promise<void>;
};

type RunState = {
  readonly tried: Set<string>;
  readonly appliedKeys: Set<string>;
  readonly results: OperationResult[];
  leaseLost: boolean;
};

type RunContext = {
  readonly proposalId: string;
  readonly token: string;
  readonly requester: IUserHasId | null;
  readonly request: ApplyRequestParameters;
};

const findRequester = (requesterId: string): Promise<IUserHasId | null> =>
  mongoose.model<IUserHasId>('User').findById(requesterId).exec();

const selectTargets = (
  proposal: ChangeProposalDocument,
  tried: ReadonlySet<string>,
): readonly OperationRecord[] => {
  const targetIndices = proposal.operations
    .filter(
      (op) =>
        op.status === 'pending' && op.approvedAt != null && !tried.has(op.key),
    )
    .map((op) => op.index);
  const byIndex = new Map(proposal.operations.map((op) => [op.index, op]));
  return planApplyOrder(proposal.operations, targetIndices).flatMap((index) => {
    const op = byIndex.get(index);
    return op == null ? [] : [op];
  });
};

// Only this run's applied operations, so an earlier run's pages are never notified again.
const keepOperations = (
  proposal: ChangeProposalDocument,
  keys: ReadonlySet<string>,
): ChangeProposalDocument => ({
  ...proposal,
  operations: proposal.operations.filter((op) => keys.has(op.key)),
});

const decidePerPageNotifications = async (
  proposalId: string,
): Promise<boolean> =>
  shouldSendPerPageNotifications(
    readChangeProposalSettings().perPageNotificationsEnabled,
    (await prisma.changeproposals.readPerPageNotifications(proposalId)) ===
      true,
  );

const writeOperation = async <T extends OperationRecord>(
  handler: OperationHandler<T>,
  op: T,
  baseContext: OperationContext,
): Promise<AttemptOutcome> => {
  const existing = await handler.findExistingResult(op, baseContext);
  if (existing != null) {
    return { outcome: existing };
  }

  const ctx: OperationContext = {
    ...baseContext,
    perPageNotifications: await decidePerPageNotifications(
      baseContext.proposalId,
    ),
  };
  const outcome: OperationOutcome = await handler.execute(op, ctx);
  if (outcome.status !== 'applied' || !ctx.perPageNotifications) {
    return { outcome };
  }
  return {
    outcome,
    notify: () => handler.sendPerPageNotifications(op, outcome, ctx),
  };
};

export const createProposalApplier = (
  crowi: Crowi,
  deps: ProposalApplierDeps = {},
): ProposalApplier => {
  const handlers = deps.handlers ?? createOperationHandlers(crowi);
  const notifier = deps.notifier ?? createProposalNotifier(crowi);
  const now = deps.now ?? (() => new Date());

  const attempt = async (
    op: OperationRecord,
    run: RunContext,
  ): Promise<AttemptOutcome> => {
    if (run.requester == null) {
      return {
        outcome: { status: 'failed', reason: 'requester-not-allowed' },
      };
    }
    const baseContext: OperationContext = {
      proposalId: run.proposalId,
      operationKey: op.key,
      requester: run.requester,
      activityParameters: run.request,
      perPageNotifications: false,
    };
    try {
      // The table is total, so the handler matches op.type; TypeScript cannot
      // correlate the two through the union, hence the widened signature.
      const handler = handlers[op.type] as OperationHandler<OperationRecord>;
      return await writeOperation(handler, op, baseContext);
    } catch (err) {
      logger.error(
        { err, proposalId: run.proposalId, operationKey: op.key },
        'Operation handler threw while applying a change proposal',
      );
      return { outcome: { status: 'failed', reason: 'write-error' } };
    }
  };

  // Returns false when the lease was lost: the run must stop without settling.
  const applyOne = async (
    op: OperationRecord,
    run: RunContext,
    state: RunState,
  ): Promise<boolean> => {
    state.tried.add(op.key);
    const { outcome, notify } = await attempt(op, run);
    const recorded = await prisma.changeproposals.recordOperationOutcome(
      run.proposalId,
      run.token,
      op.key,
      outcome,
      now(),
    );
    if (!recorded) {
      return false;
    }
    state.results.push({
      key: op.key,
      status: outcome.status,
      ...('reason' in outcome ? { reason: outcome.reason } : {}),
    });
    if (outcome.status === 'applied') {
      state.appliedKeys.add(op.key);
      await notify?.();
    }
    return prisma.changeproposals.extendApplyLease(
      run.proposalId,
      run.token,
      now(),
    );
  };

  // Re-reads after each pass so approvals recorded while this run held the lease are applied too.
  const applyApproved = async (
    run: RunContext,
    state: RunState,
  ): Promise<void> => {
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: each pass depends on the previous one's writes
      const proposal = await prisma.changeproposals.findProposal(
        run.proposalId,
      );
      const targets =
        proposal == null ? [] : selectTargets(proposal, state.tried);
      if (targets.length === 0) {
        return;
      }
      for (const op of targets) {
        // biome-ignore lint/performance/noAwaitInLoops: operations are applied strictly in the planned order
        if (!(await applyOne(op, run, state))) {
          state.leaseLost = true;
          return;
        }
      }
    }
  };

  const reportApplied = async (
    run: RunContext,
    trigger: ApplyTrigger,
    appliedKeys: ReadonlySet<string>,
  ): Promise<void> => {
    const proposal = await prisma.changeproposals.findProposal(run.proposalId);
    if (proposal == null || run.requester == null) {
      return;
    }
    const action =
      proposal.entry === 'revert'
        ? SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT
        : SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY;
    const { activityId } = recordProposalActivity(crowi, {
      action,
      proposalId: run.proposalId,
      operator: run.requester,
      trigger,
      request: run.request,
    });
    await notifier.notifyApplied({
      proposal: keepOperations(proposal, appliedKeys),
      activityId,
      action,
    });
  };

  return {
    async apply(proposalId, trigger, request = {}) {
      const token = randomUUID();
      if (
        !isValidObjectId(proposalId) ||
        !(await prisma.changeproposals.claimApplyLease(
          proposalId,
          token,
          now(),
        ))
      ) {
        return { type: 'in-progress' };
      }

      const state: RunState = {
        tried: new Set(),
        appliedKeys: new Set(),
        results: [],
        leaseLost: false,
      };
      let run: RunContext | null = null;
      try {
        const proposal = await prisma.changeproposals.findProposal(proposalId);
        run = {
          proposalId,
          token,
          requester:
            proposal == null ? null : await findRequester(proposal.requester),
          request,
        };
        await applyApproved(run, state);
        if (!state.leaseLost) {
          await prisma.changeproposals.settleIfNoPending(proposalId);
        }
      } finally {
        await prisma.changeproposals.releaseApplyLease(proposalId, token);
      }

      if (run != null && state.appliedKeys.size > 0) {
        await reportApplied(run, trigger, state.appliedKeys);
      }
      return { type: 'done', results: state.results };
    },
  };
};
