import type { IUserHasId } from '@growi/core';
import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';

import { prisma } from '~/utils/prisma';

import type { ProposalMark, RevisionMarkView } from '../../interfaces';
import { selectVisibleOperations } from '../domain';
import { loadViewablePages } from './current-page-facts';
import { contextFor, pageIdsOf } from './proposal-view-parts';
import { NO_REVERT_COUNTERPART } from './revert-counterparts';

const MAX_REVISION_IDS = 100;

type MarkedRevision = ProposalMark & { readonly revisionId: string };

const markKey = (proposalId: string, operationKey: string): string =>
  `${proposalId}:${operationKey}`;

const readMarkedRevisions = async (
  revisionIds: readonly string[],
): Promise<MarkedRevision[]> => {
  const rows = await prisma.revisions.findMany({
    where: { id: { in: [...revisionIds] } },
    select: { id: true, proposalId: true, proposalOperationKey: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  // Keep the caller's order; rows come back in index order.
  return revisionIds.flatMap((revisionId) => {
    const row = byId.get(revisionId);
    return row?.proposalId == null || row.proposalOperationKey == null
      ? []
      : [
          {
            revisionId,
            proposalId: row.proposalId,
            operationKey: row.proposalOperationKey,
          },
        ];
  });
};

export type RevisionMarksQuery = {
  // Only the first 100 distinct ids are looked at.
  getRevisionMarks(
    viewer: IUserHasId,
    revisionIds: readonly string[],
  ): Promise<readonly RevisionMarkView[]>;
};

export const createRevisionMarksQuery = (): RevisionMarksQuery => ({
  /**
   * Names the proposal behind each revision, only when the operation that made
   * it would be returned to the viewer (requirement 9.8). A hidden, unknown or
   * unmarked revision is simply absent, so the answer never tells them apart.
   */
  async getRevisionMarks(viewer, revisionIds) {
    const ids = [...new Set(revisionIds)]
      .slice(0, MAX_REVISION_IDS)
      .filter((id) => isValidObjectId(id));
    if (ids.length === 0) {
      return [];
    }
    const marked = await readMarkedRevisions(ids);
    if (marked.length === 0) {
      return [];
    }
    const proposals =
      await prisma.changeproposals.findOperationsForMarks(marked);
    const viewable = await loadViewablePages(
      proposals.flatMap((proposal) => pageIdsOf(proposal.operations)),
      viewer,
    );

    const viewerId = viewer._id.toString();
    const isRevertOf = new Map<string, boolean>();
    // Empty counterpart values: see core design.md (selectVisibleOperations / contextFor).
    for (const proposal of proposals) {
      const visible = selectVisibleOperations(
        proposal.operations,
        contextFor(
          proposal.requester,
          viewerId,
          viewable,
          NO_REVERT_COUNTERPART,
        ),
      );
      for (const op of visible) {
        isRevertOf.set(
          markKey(proposal.id, op.key),
          proposal.entry === 'revert',
        );
      }
    }

    return marked.flatMap((mark) => {
      const isRevert = isRevertOf.get(
        markKey(mark.proposalId, mark.operationKey),
      );
      return isRevert == null
        ? []
        : [
            {
              revisionId: mark.revisionId,
              proposalId: mark.proposalId,
              isRevert,
            },
          ];
    });
  },
});
