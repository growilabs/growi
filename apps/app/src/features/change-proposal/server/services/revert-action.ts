import type { IUserHasId } from '@growi/core';
import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';

import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  ApplyResult,
  ApplyTrigger,
  ChangeProposalDocument,
  OperationRecord,
  OperationStatus,
  RevertRefusalReason,
  RevertResult,
} from '../../interfaces';
import {
  buildRevertOperations,
  type CurrentPageFacts,
  judgeRevertability,
  type RevertibleOperationFacts,
  selectVisibleOperations,
  targetPageIdOf,
} from '../domain';
import type {
  RevertTargets,
  ServiceError,
  ServiceResult,
} from './change-proposal-service-types';
import {
  type DeleteAuthority,
  loadCurrentPageFacts,
  loadViewablePages,
  type ViewablePages,
} from './current-page-facts';
import { pageModel } from './operation-handlers/page-model';
import type { PageDeletePermissionService } from './page-delete-permission';
import { isRequesterAllowed } from './pre-write-checks';
import type { ProposalApplier } from './proposal-applier';
import { toRevertRefusalReason } from './to-original-operation-change';

const logger = loggerFactory(
  'growi:features:change-proposal:services:revert-action',
);

export type RevertAction = {
  revert(
    proposalId: string,
    // null stands for a guest
    user: IUserHasId | null,
    keys: RevertTargets,
    trigger: ApplyTrigger,
  ): Promise<ServiceResult<RevertResult>>;
};

type RevertOutcome = RevertResult['operations'][number];

type Judged = {
  readonly op: OperationRecord;
  readonly facts: CurrentPageFacts;
  readonly refusal: RevertRefusalReason | null;
  // Set exactly when refusal is null
  readonly revertible?: RevertibleOperationFacts;
};

// revert-refused is judged again: its cause may have gone away since.
const REVERT_CANDIDATE_STATUSES: ReadonlySet<OperationStatus> = new Set([
  'applied',
  'revert-refused',
]);

const fail = (error: ServiceError): { ok: false; error: ServiceError } => ({
  ok: false,
  error,
});

const refused = (key: string, reason: RevertRefusalReason): RevertOutcome => ({
  key,
  outcome: 'revert-refused',
  reason,
});

// Unknown keys and keys the user may not see are dropped alike, so a key's
// existence never leaks (requirement 5.4).
const chooseOperations = (
  visible: readonly OperationRecord[],
  keys: RevertTargets,
): readonly OperationRecord[] => {
  if (keys === 'all-visible') {
    return visible.filter((op) => REVERT_CANDIDATE_STATUSES.has(op.status));
  }
  const chosen = new Set(keys.filter((key) => typeof key === 'string'));
  return visible.filter((op) => chosen.has(op.key));
};

const readVisibleOperations = async (
  proposal: ChangeProposalDocument,
  user: IUserHasId,
): Promise<{
  readonly visible: readonly OperationRecord[];
  readonly viewable: ViewablePages;
}> => {
  const pageIds = proposal.operations.flatMap((op) => {
    const pageId = targetPageIdOf(op);
    return pageId == null ? [] : [pageId];
  });
  const viewable = await loadViewablePages(pageIds, user);
  const visible = selectVisibleOperations(proposal.operations, {
    isRequester: proposal.requester === user._id.toString(),
    viewablePageIds: viewable.viewablePageIds,
    anyoneWithLinkPageIds: viewable.anyoneWithLinkPageIds,
  });
  return { visible, viewable };
};

const readOriginalBodies = async (
  judged: readonly Judged[],
): Promise<ReadonlyMap<string, string>> => {
  const revisionIds = judged.flatMap(({ op, refusal }) =>
    refusal == null && op.type === 'edit' && isValidObjectId(op.baseRevisionId)
      ? [op.baseRevisionId]
      : [],
  );
  if (revisionIds.length === 0) {
    return new Map();
  }
  const revisions = await prisma.revisions.findMany({
    where: { id: { in: [...new Set(revisionIds)] } },
    select: { id: true, body: true },
  });
  return new Map(revisions.map((r) => [r.id, r.body]));
};

// What buildRevertOperations needs per operation, or null when it cannot be had.
const toRevertibleFacts = (
  { op, facts }: Judged,
  bodies: ReadonlyMap<string, string>,
): RevertibleOperationFacts | null => {
  switch (op.type) {
    case 'edit': {
      const originalBody = bodies.get(op.baseRevisionId);
      return originalBody == null ? null : { key: op.key, originalBody };
    }
    case 'trash':
      return facts.path == null
        ? null
        : {
            key: op.key,
            restoreToPath: pageModel().getRevertDeletedPageName(facts.path),
          };
    default:
      return { key: op.key };
  }
};

const toAppliedOutcome = (
  key: string,
  result: Extract<ApplyResult, { type: 'done' }>['results'][number],
): RevertOutcome | null => {
  switch (result.status) {
    case 'applied':
      return { key, outcome: 'reverted' };
    case 'skipped':
      return { key, outcome: 'skipped', reason: 'page-being-edited' };
    case 'stale':
    case 'failed':
      return refused(
        key,
        toRevertRefusalReason({ status: result.status, reason: result.reason }),
      );
    default:
      return null;
  }
};

// Judges each chosen operation against the current page; an operation that
// passes but whose revert cannot be built (its base revision is gone) is refused.
const judgeOperations = async (
  proposal: ChangeProposalDocument,
  chosen: readonly OperationRecord[],
  pages: ViewablePages['pages'],
  deleteAuthority: DeleteAuthority,
): Promise<readonly Judged[]> => {
  const factsOf = await loadCurrentPageFacts(chosen, pages, deleteAuthority);
  const preJudged: Judged[] = chosen.map((op) => {
    const facts = factsOf(op);
    const judgement = judgeRevertability(op, proposal.entry, facts);
    return {
      op,
      facts,
      refusal: judgement.revertible ? null : judgement.reason,
    };
  });

  const bodies = await readOriginalBodies(preJudged);
  return preJudged.map((entry): Judged => {
    if (entry.refusal != null) {
      return entry;
    }
    const facts = toRevertibleFacts(entry, bodies);
    if (facts == null) {
      logger.error(
        { proposalId: proposal._id, operationKey: entry.op.key },
        'The state a revert needs could not be read',
      );
      return { ...entry, refusal: 'apply-failed' };
    }
    return { ...entry, revertible: facts };
  });
};

export const createRevertAction = (deps: {
  readonly applier: ProposalApplier;
  readonly now: () => Date;
  readonly pageService: PageDeletePermissionService;
}): RevertAction => {
  const { applier, now, pageService } = deps;

  // A refusal decided before any write is recorded on the original right away.
  const recordRefusals = async (
    proposalId: string,
    judged: readonly Judged[],
  ): Promise<void> => {
    await Promise.all(
      judged.flatMap(({ op, refusal }) =>
        refusal == null || !REVERT_CANDIDATE_STATUSES.has(op.status)
          ? []
          : [
              prisma.changeproposals.markOriginalOperation(proposalId, op.key, {
                status: 'revert-refused',
                reason: refusal,
              }),
            ],
      ),
    );
  };

  // Creates the revert proposal already approved (by the reverter) and applies it
  // at once, past the settings and the auto-apply policy (requirements 5.10, 5.13).
  const createAndApply = async (
    proposal: ChangeProposalDocument,
    user: IUserHasId,
    revertible: readonly RevertibleOperationFacts[],
    trigger: ApplyTrigger,
  ): Promise<{
    readonly revertProposalId: string;
    readonly outcomes: ReadonlyMap<string, RevertOutcome>;
  }> => {
    const approvedAt = now();
    const revertProposal = await prisma.changeproposals.createProposal({
      requester: user._id.toString(),
      entry: 'revert',
      revertOf: proposal._id,
      perPageNotifications: proposal.perPageNotifications,
      operations: buildRevertOperations(
        { proposalId: proposal._id, operations: proposal.operations },
        revertible,
      ).map((op) => ({ ...op, approvedAt })),
    });

    let applied: ApplyResult;
    try {
      applied = await applier.apply(revertProposal._id, trigger);
    } catch (err) {
      // The operations are approved, so the maintenance cron resumes the apply.
      logger.error(
        { err, proposalId: revertProposal._id },
        'Applying a revert proposal failed',
      );
      applied = { type: 'in-progress' };
    }

    const originalKeyOf = new Map(
      revertProposal.operations.map((op) => [
        op.key,
        op.revertTarget?.operationKey,
      ]),
    );
    const outcomes = new Map<string, RevertOutcome>();
    if (applied.type === 'done') {
      for (const result of applied.results) {
        const originalKey = originalKeyOf.get(result.key);
        const outcome =
          originalKey == null ? null : toAppliedOutcome(originalKey, result);
        if (outcome != null) {
          outcomes.set(outcome.key, outcome);
        }
      }
    }
    return { revertProposalId: revertProposal._id, outcomes };
  };

  return {
    async revert(proposalId, user, keys, trigger) {
      if (!isRequesterAllowed(user)) {
        return fail({ code: 'user-not-allowed' });
      }
      const proposal =
        keys === 'all-visible' || Array.isArray(keys)
          ? await prisma.changeproposals.findProposal(proposalId)
          : null;
      if (proposal == null) {
        return fail({ code: 'not-found' });
      }

      const { visible, viewable } = await readVisibleOperations(proposal, user);
      if (proposal.requester !== user._id.toString() && visible.length === 0) {
        return fail({ code: 'not-found' });
      }

      const judged = await judgeOperations(
        proposal,
        chooseOperations(visible, keys),
        viewable.pages,
        { user, pageService },
      );
      const revertible = judged.flatMap((entry) =>
        entry.revertible == null ? [] : [entry.revertible],
      );
      await recordRefusals(proposal._id, judged);

      const created =
        revertible.length === 0
          ? null
          : await createAndApply(proposal, user, revertible, trigger);

      // A revert operation still pending (the apply was taken over) has no outcome yet.
      const operations = judged.flatMap(({ op, refusal }) => {
        const outcome =
          refusal == null
            ? created?.outcomes.get(op.key)
            : refused(op.key, refusal);
        return outcome == null ? [] : [outcome];
      });
      return {
        ok: true,
        value:
          created == null
            ? { operations }
            : { revertProposalId: created.revertProposalId, operations },
      };
    },
  };
};
