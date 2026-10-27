import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

import type {
  BasedOn,
  ChangeProposalDocument,
  ChangeProposalView,
  OperationRecord,
  OperationStatus,
  RequesterProposalState,
} from '../../interfaces';
import {
  buildProposalLinks,
  computeAchievement,
  deriveProposalStatus,
  judgeRevertability,
  type LinkedProposalFacts,
  selectVisibleOperations,
  targetPageIdOf,
  type VisibilityContext,
  type VisibilityOperationFacts,
} from '../domain';
import type { LinkedProposalRecord } from '../models/change-proposal-types';
import type { ServiceResult } from './change-proposal-service-types';
import {
  loadCurrentPageFacts,
  loadViewablePages,
  type ViewablePages,
} from './current-page-facts';
import { isRequesterAllowed } from './pre-write-checks';
import { readChangeProposalSettings } from './settings';
import { toOperationView } from './to-operation-view';

export type ProposalQuery = {
  getForViewer(
    proposalId: string,
    viewer: IUserHasId,
  ): Promise<ServiceResult<ChangeProposalView>>;
};

const NOT_FOUND = { ok: false, error: { code: 'not-found' } } as const;

const REVERTIBILITY_STATUSES: ReadonlySet<OperationStatus> = new Set([
  'applied',
  'revert-refused',
]);

const userModel = () => mongoose.model<IUserHasId>('User');

const pageIdsOf = (operations: readonly VisibilityOperationFacts[]): string[] =>
  operations.flatMap((op) => {
    const pageId = targetPageIdOf(op);
    return pageId == null ? [] : [pageId];
  });

const contextFor = (
  requesterId: string,
  viewerId: string,
  viewable: ViewablePages,
): VisibilityContext => ({
  isRequester: requesterId === viewerId,
  viewablePageIds: viewable.viewablePageIds,
  anyoneWithLinkPageIds: viewable.anyoneWithLinkPageIds,
});

// The newest appliedAt among the returned operations; the stored value may come
// from an operation the viewer must not learn about (requirement 9.10).
const newestAppliedAt = (
  operations: readonly OperationRecord[],
): Date | undefined =>
  operations.reduce<Date | undefined>(
    (newest, op) =>
      op.appliedAt != null && (newest == null || op.appliedAt > newest)
        ? op.appliedAt
        : newest,
    undefined,
  );

const toLinkedFacts = (
  linked: readonly LinkedProposalRecord[],
  viewerId: string,
  viewable: ViewablePages,
): LinkedProposalFacts[] =>
  linked.map((record) => ({
    proposalId: record.id,
    relation: record.basedOn.relation,
    operationKeys: record.basedOn.operationKeys,
    isVisibleToViewer:
      selectVisibleOperations(
        record.operations,
        contextFor(record.requester, viewerId, viewable),
      ).length > 0,
  }));

// Non-requesters get the base link only when they can open the base, and only
// with the base operations returned to them; an empty result drops the link.
const narrowBasedOn = (
  basedOn: BasedOn,
  base: ChangeProposalDocument | null,
  viewerId: string,
  viewable: ViewablePages,
): BasedOn | undefined => {
  if (base == null) {
    return undefined;
  }
  const visibleKeys = new Set(
    selectVisibleOperations(
      base.operations,
      contextFor(base.requester, viewerId, viewable),
    ).map((op) => op.key),
  );
  const operationKeys = basedOn.operationKeys.filter((key) =>
    visibleKeys.has(key),
  );
  return operationKeys.length === 0 ? undefined : { ...basedOn, operationKeys };
};

const requesterStateOf = (
  proposal: ChangeProposalDocument,
  visible: readonly OperationRecord[],
): RequesterProposalState => {
  const achievement = computeAchievement(proposal.entry, visible);
  return {
    lifecycle: proposal.lifecycle,
    ...(achievement == null ? {} : { achievement }),
    perPageNotifications: {
      value: proposal.perPageNotifications,
      isEnabledBySettings:
        readChangeProposalSettings().perPageNotificationsEnabled,
    },
  };
};

const readRequester = async (
  requesterId: string,
): Promise<ChangeProposalView['requester']> => {
  const user = await userModel()
    .findById(requesterId, { username: 1, name: 1 })
    .lean();
  return {
    id: requesterId,
    username: user?.username ?? '',
    name: user?.name ?? '',
  };
};

/**
 * Builds what one viewer may see of a proposal. Every page involved — the
 * proposal's, its follow-ups' and reworks', and its base's — is checked in a
 * single findByIdsAndViewer call, read the same way as a revert reads it.
 */
export const createProposalQuery = (): ProposalQuery => ({
  async getForViewer(proposalId, viewer) {
    const proposal = await prisma.changeproposals.findProposal(proposalId);
    if (proposal == null) {
      return NOT_FOUND;
    }
    const viewerId = viewer._id.toString();
    const isRequester = proposal.requester === viewerId;

    // The requester's links all lead to their own proposals, so only other
    // viewers need the linked and base proposals' pages checked.
    const [linked, base] = await Promise.all([
      prisma.changeproposals.findLinkedProposals(proposal._id),
      !isRequester && proposal.basedOn != null
        ? prisma.changeproposals.findProposal(proposal.basedOn.proposalId)
        : null,
    ]);
    const viewable = await loadViewablePages(
      [
        ...pageIdsOf(proposal.operations),
        ...(isRequester ? [] : linked.flatMap((l) => pageIdsOf(l.operations))),
        ...(base == null ? [] : pageIdsOf(base.operations)),
      ],
      viewer,
    );

    const visible = selectVisibleOperations(
      proposal.operations,
      contextFor(proposal.requester, viewerId, viewable),
    );
    if (!isRequester && visible.length === 0) {
      return NOT_FOUND;
    }

    // Only operations this viewer could actually revert get a judgement, so the
    // view never disagrees with what revert() would do for them (requirement 5.14).
    const revertCandidates = isRequesterAllowed(viewer)
      ? visible.filter((op) => REVERTIBILITY_STATUSES.has(op.status))
      : [];
    const [factsOf, requester] = await Promise.all([
      revertCandidates.length === 0
        ? null
        : loadCurrentPageFacts(revertCandidates, viewable.pages),
      readRequester(proposal.requester),
    ]);
    const candidateKeys = new Set(revertCandidates.map((op) => op.key));
    const links = buildProposalLinks(
      visible.map((op) => op.key),
      isRequester
        ? linked.map((record) => ({
            proposalId: record.id,
            relation: record.basedOn.relation,
            operationKeys: record.basedOn.operationKeys,
            isVisibleToViewer: true,
          }))
        : toLinkedFacts(linked, viewerId, viewable),
    );

    const operations = visible.map((op) => {
      const pageId = targetPageIdOf(op);
      const page = pageId == null ? undefined : viewable.pages.get(pageId);
      return toOperationView(op, {
        isRequester,
        page:
          page == null
            ? undefined
            : { id: page._id.toString(), path: page.path },
        revertability:
          factsOf != null && candidateKeys.has(op.key)
            ? judgeRevertability(op, proposal.entry, factsOf(op))
            : undefined,
        linkedProposals: links.get(op.key),
      });
    });

    const lastAppliedAt = isRequester
      ? proposal.lastAppliedAt
      : newestAppliedAt(visible);
    const basedOn =
      proposal.basedOn == null || isRequester
        ? proposal.basedOn
        : narrowBasedOn(proposal.basedOn, base, viewerId, viewable);

    return {
      ok: true,
      value: {
        id: proposal._id,
        requester,
        entry: proposal.entry,
        ...(proposal.modelLabel == null
          ? {}
          : { modelLabel: proposal.modelLabel }),
        createdAt: proposal.createdAt.toISOString(),
        ...(lastAppliedAt == null
          ? {}
          : { lastAppliedAt: lastAppliedAt.toISOString() }),
        status: deriveProposalStatus(proposal.lifecycle, visible),
        isRequester,
        ...(proposal.revertOf == null ? {} : { revertOf: proposal.revertOf }),
        ...(basedOn == null ? {} : { basedOn }),
        ...(isRequester
          ? { requesterState: requesterStateOf(proposal, visible) }
          : {}),
        operations,
      },
    };
  },
});
