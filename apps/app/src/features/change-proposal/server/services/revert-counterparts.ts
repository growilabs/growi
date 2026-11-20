import {
  collectCreatedPaths,
  targetPageIdOf,
  type VisibilityContext,
  type VisibilityOperationFacts,
} from '../domain';
import type { RevertCounterpartRecord } from '../models/change-proposal-types';

export type RevertCounterpartValues = Pick<
  VisibilityContext,
  'isOriginalRequester' | 'revertProposalIdsByViewer'
>;

export type RevertCounterpartFacts = RevertCounterpartValues & {
  // The original's create paths by operation key; empty for any non-revert proposal.
  readonly createdPaths: ReadonlyMap<string, string>;
};

// A proposal about to go through selectVisibleOperations.
export type RevertCounterpartSource = {
  readonly revertOf?: string;
  readonly operations: readonly VisibilityOperationFacts[];
};

// For selecting revert targets and revision marks, which never use counterparts.
export const NO_REVERT_COUNTERPART: RevertCounterpartValues = {
  isOriginalRequester: false,
  revertProposalIdsByViewer: new Set(),
};

const revertedByOnGonePages = (
  proposal: RevertCounterpartSource,
  deletedPageIds: ReadonlySet<string>,
): string[] =>
  proposal.operations.flatMap((op) => {
    const pageId = targetPageIdOf(op);
    return pageId != null &&
      deletedPageIds.has(pageId) &&
      op.revertedByProposalId != null
      ? [op.revertedByProposalId]
      : [];
  });

/**
 * The proposals whose requesters decide the counterparts: every revert's
 * original (also needed for its create paths), and the revert of each
 * operation whose page is gone.
 */
export const revertCounterpartIdsOf = (
  proposals: readonly RevertCounterpartSource[],
  deletedPageIds: ReadonlySet<string>,
): string[] => [
  ...new Set(
    proposals.flatMap((proposal) => [
      ...(proposal.revertOf == null ? [] : [proposal.revertOf]),
      ...revertedByOnGonePages(proposal, deletedPageIds),
    ]),
  ),
];

export const revertCounterpartFactsOf = (
  proposal: RevertCounterpartSource,
  viewerId: string,
  counterparts: ReadonlyMap<string, RevertCounterpartRecord>,
  deletedPageIds: ReadonlySet<string>,
): RevertCounterpartFacts => {
  const original =
    proposal.revertOf == null ? undefined : counterparts.get(proposal.revertOf);
  return {
    isOriginalRequester: original?.requester === viewerId,
    revertProposalIdsByViewer: new Set(
      revertedByOnGonePages(proposal, deletedPageIds).filter(
        (id) => counterparts.get(id)?.requester === viewerId,
      ),
    ),
    createdPaths:
      original == null ? new Map() : collectCreatedPaths(original.operations),
  };
};
