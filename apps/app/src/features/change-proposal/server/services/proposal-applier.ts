import { randomUUID } from 'node:crypto';
import type { IUserHasId } from '@growi/core';
import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { getYjsService } from '~/server/service/yjs';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  ApplyResult,
  ApplyTrigger,
  ChangeProposalDocument,
  OperationRecord,
  WaitingReason,
} from '../../interfaces';
import { planApplyOrder, shouldSendPerPageNotifications } from '../domain';
import type { RecordedOutcome } from '../models/change-proposal-types';
import type { EditingPresenceSource } from './editing-presence';
import {
  markOriginalOperationWithRetry,
  type WriteOriginalMark,
  waitBeforeMarkRetry,
  writeOriginalMarkToDb,
} from './mark-original-operation';
import {
  createOperationHandlers,
  type OperationContext,
  type OperationHandler,
  type OperationHandlerTable,
  type OperationOutcome,
} from './operation-handlers';
import {
  checkWritesEnabled,
  DEFAULT_PAGE_OPERATION_WAIT,
  findPageBlocker,
  isRequesterAllowed,
  type PageOperationWait,
} from './pre-write-checks';
import { recordProposalActivity } from './proposal-activity';
import {
  createProposalNotifier,
  type ProposalNotifier,
} from './proposal-notifier';
import { readChangeProposalSettings } from './settings';
import { toOriginalOperationChange } from './to-original-operation-change';

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
  // Resolved at check time by default: the YjsService is initialized after the services.
  readonly presenceSource?: EditingPresenceSource;
  readonly pageOperationWait?: PageOperationWait;
  readonly markRetryWait?: () => Promise<void>;
  readonly writeOriginalMark?: WriteOriginalMark;
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
  readonly isRevert: boolean;
  readonly requesterId: string | null;
  readonly requester: IUserHasId | null;
  readonly request: ApplyRequestParameters;
};

const findRequester = (
  requesterId: string | null,
): Promise<IUserHasId | null> =>
  requesterId == null
    ? Promise.resolve(null)
    : mongoose.model<IUserHasId>('User').findById(requesterId).exec();

// A revert never goes back to waiting: it is skipped (the original stays applied)
// or failed (the original is refused), so it can simply be requested again.
const toBlockedOutcome = (
  reason: WaitingReason,
  isRevert: boolean,
): RecordedOutcome => {
  if (!isRevert) {
    return { status: 'pending', reason };
  }
  return reason === 'page-being-edited'
    ? { status: 'skipped', reason }
    : { status: 'failed', reason };
};

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

// Either why the operation must not be written now, or the requester to write as.
type WriteGate =
  | { readonly blocked: RecordedOutcome }
  | { readonly requester: IUserHasId };

// findExistingResult comes first (design 反映の流れ): it may finish an interrupted
// write's cleanup, and a write that already happened is recorded as applied even if
// the settings, the requester or the page state changed since.
const writeOperation = async <T extends OperationRecord>(
  handler: OperationHandler<T>,
  op: T,
  run: Pick<RunContext, 'proposalId' | 'request'>,
  checkBeforeWrite: () => Promise<WriteGate>,
): Promise<AttemptOutcome> => {
  const existing = await handler.findExistingResult(op, {
    proposalId: run.proposalId,
  });
  if (existing != null) {
    return { outcome: existing };
  }
  const gate = await checkBeforeWrite();
  if ('blocked' in gate) {
    return { outcome: gate.blocked };
  }

  const ctx: OperationContext = {
    proposalId: run.proposalId,
    operationKey: op.key,
    requester: gate.requester,
    activityParameters: run.request,
    perPageNotifications: await decidePerPageNotifications(run.proposalId),
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
  const pageOperationWait =
    deps.pageOperationWait ?? DEFAULT_PAGE_OPERATION_WAIT;
  const originalMark = {
    write: deps.writeOriginalMark ?? writeOriginalMarkToDb,
    wait: deps.markRetryWait ?? waitBeforeMarkRetry,
  };

  // Design order: settings (not for reverts), requester, editing presence, overlap.
  const checkBeforeWrite = async (
    op: OperationRecord,
    run: RunContext,
  ): Promise<WriteGate> => {
    if (!run.isRevert) {
      const disabled = checkWritesEnabled(op, readChangeProposalSettings());
      if (disabled != null) {
        return { blocked: { status: 'failed', reason: disabled } };
      }
    }
    // Read per operation: the requester may be suspended or made read-only mid-run.
    const requester = await findRequester(run.requesterId);
    if (!isRequesterAllowed(requester)) {
      return { blocked: { status: 'failed', reason: 'requester-not-allowed' } };
    }
    const blocker = await findPageBlocker(op, {
      presenceSource: deps.presenceSource ?? getYjsService(),
      canOperate: (...scope) => crowi.pageOperationService.canOperate(...scope),
      wait: pageOperationWait,
    });
    return blocker == null
      ? { requester }
      : { blocked: toBlockedOutcome(blocker, run.isRevert) };
  };

  const attempt = async (
    op: OperationRecord,
    run: RunContext,
  ): Promise<AttemptOutcome> => {
    try {
      // The table is total, so the handler matches op.type; TypeScript cannot
      // correlate the two through the union, hence the widened signature.
      const handler = handlers[op.type] as OperationHandler<OperationRecord>;
      return await writeOperation(handler, op, run, () =>
        checkBeforeWrite(op, run),
      );
    } catch (err) {
      logger.error(
        { err, proposalId: run.proposalId, operationKey: op.key },
        'Operation handler threw while applying a change proposal',
      );
      return { outcome: { status: 'failed', reason: 'write-error' } };
    }
  };

  // Only a revert writes to the original proposal (requirements 13.5, 13.6).
  const markOriginalOperation = async (
    op: OperationRecord,
    outcome: RecordedOutcome,
    run: RunContext,
  ): Promise<void> => {
    if (!run.isRevert || op.revertTarget == null) {
      return;
    }
    const change = toOriginalOperationChange(outcome, run.proposalId, now());
    if (change == null) {
      return;
    }
    const logContext = {
      proposalId: run.proposalId,
      revertTarget: op.revertTarget,
    };
    try {
      const marked = await markOriginalOperationWithRetry(
        op.revertTarget,
        change,
        originalMark,
      );
      if (!marked) {
        logger.warn(
          logContext,
          'The original operation was no longer revertible; its state was left as is',
        );
      }
    } catch (err) {
      // The revert outcome is already recorded; a failed mark must not stop the run.
      logger.error(
        { ...logContext, err },
        'Failed to write the revert result onto the original operation after retrying',
      );
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
    await markOriginalOperation(op, outcome, run);
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

  // A later run reports only what it applies itself, so the writes of a run that
  // threw are reported now or never (requirement 7.5). The run's own error is
  // what the caller must see, so a reporting failure is only logged.
  const reportAppliedBeforeFailure = async (
    run: RunContext,
    trigger: ApplyTrigger,
    appliedKeys: ReadonlySet<string>,
  ): Promise<void> => {
    try {
      await reportApplied(run, trigger, appliedKeys);
    } catch (err) {
      logger.error(
        { err, proposalId: run.proposalId },
        'Failed to report the operations applied before the run stopped',
      );
    }
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
        try {
          const proposal =
            await prisma.changeproposals.findProposal(proposalId);
          const requesterId = proposal?.requester ?? null;
          run = {
            proposalId,
            token,
            isRevert: proposal?.entry === 'revert',
            requesterId,
            requester: await findRequester(requesterId),
            request,
          };
          await applyApproved(run, state);
          if (!state.leaseLost) {
            await prisma.changeproposals.settleIfNoPending(proposalId);
          }
        } finally {
          await prisma.changeproposals.releaseApplyLease(proposalId, token);
        }
      } catch (runError) {
        if (run != null && state.appliedKeys.size > 0) {
          await reportAppliedBeforeFailure(run, trigger, state.appliedKeys);
        }
        throw runError;
      }

      if (run != null && state.appliedKeys.size > 0) {
        await reportApplied(run, trigger, state.appliedKeys);
      }
      return { type: 'done', results: state.results };
    },
  };
};
