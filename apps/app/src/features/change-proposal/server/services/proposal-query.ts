import type { IUserHasId } from '@growi/core';

import { prisma } from '~/utils/prisma';

import type {
  BasedOn,
  ChangeProposalDocument,
  ChangeProposalView,
  OperationRecord,
  OperationStatus,
  OperationView,
  ProposalLinkView,
  Revertability,
} from '../../interfaces';
import {
  buildProposalLinks,
  judgeRevertability,
  type LinkedProposalFacts,
  recordedPathOf,
  selectVisibleOperations,
  targetPageIdOf,
} from '../domain';
import type { LinkedProposalRecord } from '../models/change-proposal-types';
import type { ServiceResult } from './change-proposal-service-types';
import {
  loadCurrentPageFacts,
  loadViewablePages,
  type ViewablePages,
} from './current-page-facts';
import type { PageDeletePermissionServices } from './page-delete-permission';
import { isRequesterAllowed } from './pre-write-checks';
import {
  type AppliedListScan,
  createProposalListQuery,
  type ProposalListQuery,
} from './proposal-list-query';
import {
  contextFor,
  loadRevertCounterparts,
  pageIdsOf,
  readRequesters,
  toProposalHeaderView,
} from './proposal-view-parts';
import type {
  RevertCounterpartFacts,
  RevertCounterpartSource,
} from './revert-counterparts';
import {
  createRevisionMarksQuery,
  type RevisionMarksQuery,
} from './revision-marks-query';
import { readChangeProposalSettings } from './settings';
import { toOperationView } from './to-operation-view';

export type ProposalQuery = ProposalListQuery &
  RevisionMarksQuery & {
    getForViewer(
      proposalId: string,
      viewer: IUserHasId,
    ): Promise<ServiceResult<ChangeProposalView>>;
  };

export type ProposalQueryDeps = {
  readonly appliedListScan?: AppliedListScan;
  readonly deletePermission: PageDeletePermissionServices;
};

const NOT_FOUND = { ok: false, error: { code: 'not-found' } } as const;

const REVERTIBILITY_STATUSES: ReadonlySet<OperationStatus> = new Set([
  'applied',
  'revert-refused',
]);

type CounterpartsOf = (
  proposal: RevertCounterpartSource,
) => RevertCounterpartFacts;

// Everything a visibility check needs, read once for the proposal, its links and its base.
type Visibility = {
  readonly viewerId: string;
  readonly viewable: ViewablePages;
  readonly counterpartsOf: CounterpartsOf;
};

const visibleOperationsOf = <
  T extends RevertCounterpartSource['operations'][number],
>(
  proposal: RevertCounterpartSource & {
    readonly requester: string;
    readonly operations: readonly T[];
  },
  { viewerId, viewable, counterpartsOf }: Visibility,
): readonly T[] =>
  selectVisibleOperations(
    proposal.operations,
    contextFor(
      proposal.requester,
      viewerId,
      viewable,
      counterpartsOf(proposal),
    ),
  );

const toLinkedFacts = (
  linked: readonly LinkedProposalRecord[],
  visibility: Visibility,
): LinkedProposalFacts[] =>
  linked.map((record) => ({
    proposalId: record.id,
    relation: record.basedOn.relation,
    operationKeys: record.basedOn.operationKeys,
    isVisibleToViewer: visibleOperationsOf(record, visibility).length > 0,
  }));

// Non-requesters get the base link only when they can open the base, and only
// with the base operations returned to them; an empty result drops the link.
const narrowBasedOn = (
  basedOn: BasedOn,
  base: ChangeProposalDocument | null,
  visibility: Visibility,
): BasedOn | undefined => {
  if (base == null) {
    return undefined;
  }
  const visibleKeys = new Set(
    visibleOperationsOf(base, visibility).map((op) => op.key),
  );
  const operationKeys = basedOn.operationKeys.filter((key) =>
    visibleKeys.has(key),
  );
  return operationKeys.length === 0 ? undefined : { ...basedOn, operationKeys };
};

const loadVisibility = async (
  viewer: IUserHasId,
  checked: readonly (RevertCounterpartSource & {
    readonly requester: string;
  })[],
): Promise<Visibility> => {
  const viewerId = viewer._id.toString();
  const viewable = await loadViewablePages(
    checked.flatMap((proposal) => pageIdsOf(proposal.operations)),
    viewer,
  );
  const counterpartsOf = await loadRevertCounterparts(
    checked,
    viewerId,
    viewable.deletedPageIds,
  );
  return { viewerId, viewable, counterpartsOf };
};

const isOnGonePage = (
  op: OperationRecord,
  deletedPageIds: ReadonlySet<string>,
): boolean => {
  const pageId = targetPageIdOf(op);
  return pageId != null && deletedPageIds.has(pageId);
};

// Only operations this viewer could actually revert get a judgement, so the view
// never disagrees with what revert() would do for them (requirement 5.14; see the
// core design for why a gone page counts only for the requester).
const selectRevertCandidates = (
  visible: readonly OperationRecord[],
  viewer: IUserHasId,
  isRequester: boolean,
  deletedPageIds: ReadonlySet<string>,
): readonly OperationRecord[] =>
  isRequesterAllowed(viewer)
    ? visible.filter(
        (op) =>
          REVERTIBILITY_STATUSES.has(op.status) &&
          (isRequester || !isOnGonePage(op, deletedPageIds)),
      )
    : [];

// The path returned for edit and delete-completely (requirement 9.12, 9.13).
const suppliedPathOf = (
  op: OperationRecord,
  createdPaths: ReadonlyMap<string, string>,
  deletedPageIds: ReadonlySet<string>,
): string | undefined => {
  switch (op.type) {
    case 'delete-completely':
      return recordedPathOf(op, createdPaths);
    case 'edit':
      return isOnGonePage(op, deletedPageIds)
        ? recordedPathOf(op, createdPaths)
        : undefined;
    default:
      return undefined;
  }
};

type RevertabilityOf = (op: OperationRecord) => Revertability | undefined;

const loadRevertabilityOf = async (args: {
  readonly proposal: ChangeProposalDocument;
  readonly visible: readonly OperationRecord[];
  readonly viewer: IUserHasId;
  readonly viewable: ViewablePages;
  readonly deletePermission: PageDeletePermissionServices;
}): Promise<RevertabilityOf> => {
  const { proposal, viewer, viewable } = args;
  const candidates = selectRevertCandidates(
    args.visible,
    viewer,
    proposal.requester === viewer._id.toString(),
    viewable.deletedPageIds,
  );
  if (candidates.length === 0) {
    return () => undefined;
  }
  const factsOf = await loadCurrentPageFacts(candidates, viewable.pages, {
    user: viewer,
    services: args.deletePermission,
  });
  const candidateKeys = new Set(candidates.map((op) => op.key));
  return (op) =>
    candidateKeys.has(op.key)
      ? judgeRevertability(op, proposal.entry, factsOf(op))
      : undefined;
};

const toOperationViews = (args: {
  readonly visible: readonly OperationRecord[];
  readonly isRequester: boolean;
  readonly viewable: ViewablePages;
  readonly createdPaths: ReadonlyMap<string, string>;
  readonly revertabilityOf: RevertabilityOf;
  readonly links: ReadonlyMap<string, readonly ProposalLinkView[]>;
}): OperationView[] => {
  const { viewable } = args;
  return args.visible.map((op) => {
    const pageId = targetPageIdOf(op);
    const page = pageId == null ? undefined : viewable.pages.get(pageId);
    return toOperationView(op, {
      isRequester: args.isRequester,
      page:
        page == null ? undefined : { id: page._id.toString(), path: page.path },
      path: suppliedPathOf(op, args.createdPaths, viewable.deletedPageIds),
      revertability: args.revertabilityOf(op),
      linkedProposals: args.links.get(op.key),
    });
  });
};

const linkFactsFor = (
  linked: readonly LinkedProposalRecord[],
  isRequester: boolean,
  visibility: Visibility,
): LinkedProposalFacts[] =>
  isRequester
    ? linked.map((record) => ({
        proposalId: record.id,
        relation: record.basedOn.relation,
        operationKeys: record.basedOn.operationKeys,
        isVisibleToViewer: true,
      }))
    : toLinkedFacts(linked, visibility);

/**
 * Builds what one viewer may see of a proposal. Every page involved — the
 * proposal's, its follow-ups' and reworks', and its base's — is checked in a
 * single findByIdsAndViewer call, read the same way as a revert reads it, and
 * their revert counterparts are read in a single query too.
 */
export const createProposalQuery = (
  deps: ProposalQueryDeps,
): ProposalQuery => ({
  ...createProposalListQuery(deps.appliedListScan),
  ...createRevisionMarksQuery(),
  async getForViewer(proposalId, viewer) {
    const proposal = await prisma.changeproposals.findProposal(proposalId);
    if (proposal == null) {
      return NOT_FOUND;
    }
    const isRequester = proposal.requester === viewer._id.toString();

    const [linked, base] = await Promise.all([
      prisma.changeproposals.findLinkedProposals(proposal._id),
      !isRequester && proposal.basedOn != null
        ? prisma.changeproposals.findProposal(proposal.basedOn.proposalId)
        : null,
    ]);
    // The requester's links all lead to their own proposals, so only other
    // viewers need the linked and base proposals checked.
    const visibility = await loadVisibility(viewer, [
      proposal,
      ...(isRequester ? [] : linked),
      ...(base == null ? [] : [base]),
    ]);
    const { viewable } = visibility;

    const visible = visibleOperationsOf(proposal, visibility);
    if (!isRequester && visible.length === 0) {
      return NOT_FOUND;
    }

    const [revertabilityOf, requesterOf] = await Promise.all([
      loadRevertabilityOf({
        proposal,
        visible,
        viewer,
        viewable,
        deletePermission: deps.deletePermission,
      }),
      readRequesters([proposal.requester]),
    ]);
    const operations = toOperationViews({
      visible,
      isRequester,
      viewable,
      createdPaths: visibility.counterpartsOf(proposal).createdPaths,
      revertabilityOf,
      links: buildProposalLinks(
        visible.map((op) => op.key),
        linkFactsFor(linked, isRequester, visibility),
      ),
    });

    const basedOn =
      proposal.basedOn == null || isRequester
        ? proposal.basedOn
        : narrowBasedOn(proposal.basedOn, base, visibility);

    return {
      ok: true,
      value: {
        ...toProposalHeaderView({
          id: proposal._id,
          proposal,
          visible,
          isRequester,
          requester: requesterOf(proposal.requester),
          isPerPageNotificationsEnabled:
            readChangeProposalSettings().perPageNotificationsEnabled,
        }),
        ...(basedOn == null ? {} : { basedOn }),
        operations,
      },
    };
  },
});
