import type { IUserHasId } from '@growi/core';
import { getIdStringForRef } from '@growi/core';

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
  ReviewerRef,
  ViewerRole,
} from '../../interfaces';
import {
  buildProposalLinks,
  deriveViewerRole,
  judgeRevertability,
  type LinkedProposalFacts,
  type ReviewScopeOperation,
  targetPageIdOf,
  type ViewerIdentity,
} from '../domain';
import type { LinkedProposalRecord } from '../models/change-proposal-types';
import type { ServiceResult } from './change-proposal-service-types';
import {
  type DeleteAuthority,
  loadCurrentPageFacts,
  type ViewablePages,
} from './current-page-facts';
import type { PageDeletePermissionServices } from './page-delete-permission';
import { readParticipantNames } from './participant-names';
import { isRequesterAllowed } from './pre-write-checks';
import {
  type AppliedListScan,
  createProposalListQuery,
  type ProposalListQuery,
} from './proposal-list-query';
import { pageIdsOf, toProposalHeaderView } from './proposal-view-parts';
import {
  createReviewQueueQuery,
  type ReviewQueuePage,
} from './review-queue-query';
import {
  type ReviewScopeResult,
  resolveReviewScopesWithPages,
} from './review-scope-resolver';
import {
  latestReviews,
  type OperationDecisionViews,
  type ParticipantHeaderFields,
  type ReviewTargetValues,
  reviewTargetValuesOf,
  toOperationDecisionViews,
  toParticipantHeaderFields,
  type UserSummaryOf,
} from './review-views';
import { loadViewerIdentity } from './reviewer-identity';
import {
  createRevisionMarksQuery,
  type RevisionMarksQuery,
} from './revision-marks-query';
import { readChangeProposalSettings } from './settings';
import { toOperationView } from './to-operation-view';

export type ProposalQuery = ProposalListQuery &
  RevisionMarksQuery & {
    // The viewer's membership is read once here; the query itself never reads it.
    listReviewQueue(
      viewer: IUserHasId,
      cursor: string | null,
      limit: number,
    ): Promise<ReviewQueuePage>;
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

// A follow-up, rework or base proposal, judged by the viewer's own role in it.
type RelatedProposal = {
  readonly id: string;
  readonly requester: string;
  readonly reviewers: readonly ReviewerRef[];
  readonly operations: readonly ReviewScopeOperation[];
};

type ViewerScope = {
  readonly role: ViewerRole;
  readonly scope: ReviewScopeResult;
  readonly visible: readonly OperationRecord[];
  readonly viewable: ViewablePages;
  readonly relatedVisibleKeys: ReadonlyMap<string, ReadonlySet<string>>;
};

// Non-requesters get the base link only with the base operations returned to
// them by their role in the base; an empty result drops the link.
const narrowBasedOn = (
  basedOn: BasedOn,
  baseVisibleKeys: ReadonlySet<string> | undefined,
): BasedOn | undefined => {
  const operationKeys = basedOn.operationKeys.filter(
    (key) => baseVisibleKeys?.has(key) ?? false,
  );
  return operationKeys.length === 0 ? undefined : { ...basedOn, operationKeys };
};

const toLinkedFacts = (
  linked: readonly LinkedProposalRecord[],
  isVisible: (proposalId: string) => boolean,
): LinkedProposalFacts[] =>
  linked.map((record) => ({
    proposalId: record.id,
    relation: record.basedOn.relation,
    operationKeys: record.basedOn.operationKeys,
    isVisibleToViewer: isVisible(record.id),
  }));

// Every page involved — the proposal's and each related proposal's, by the
// viewer's role in each — is checked in one viewing check, with the groups the
// caller already read.
const readViewerScope = async (
  proposal: ChangeProposalDocument,
  identity: ViewerIdentity,
  related: readonly RelatedProposal[],
): Promise<ViewerScope> => {
  const roleIn = (p: Pick<RelatedProposal, 'requester' | 'reviewers'>) =>
    deriveViewerRole(p.requester, p.reviewers, identity);
  const role = roleIn(proposal);
  const { scopes, viewable } = await resolveReviewScopesWithPages(
    [proposal, ...related].map((p) => ({
      operations: p.operations,
      role: roleIn(p),
    })),
    identity,
    pageIdsOf(proposal.operations),
  );
  const [scope, ...relatedScopes] = scopes;
  return {
    role,
    scope,
    visible: proposal.operations.filter((op) => scope.visibleKeys.has(op.key)),
    viewable,
    relatedVisibleKeys: new Map(
      related.map((p, i) => [p.id, relatedScopes[i].visibleKeys]),
    ),
  };
};

/**
 * The participant-only parts of the view and the names they show. Per-operation
 * records are kept only on the visible operations, whole-proposal ones only for
 * the requester (Req 17.8); anyone else gets none of them.
 */
const readParticipantViews = async (
  proposal: ChangeProposalDocument,
  role: ViewerRole,
  visible: readonly OperationRecord[],
): Promise<{
  readonly userOf: UserSummaryOf;
  readonly header: ParticipantHeaderFields;
  readonly decisionsOf: (op: OperationRecord) => OperationDecisionViews;
}> => {
  if (role === 'other') {
    const { userOf } = await readParticipantNames([proposal.requester], []);
    return { userOf, header: {}, decisionsOf: () => ({}) };
  }
  const visibleKeys = new Set(visible.map((op) => op.key));
  const latest = latestReviews(proposal.reviews).filter((r) =>
    r.operationKey == null
      ? role === 'requester'
      : visibleKeys.has(r.operationKey),
  );
  const { userOf, groupNameOf } = await readParticipantNames(
    [
      proposal.requester,
      ...proposal.reviewers.flatMap((r) => [
        ...(r.kind === 'user' ? [r.id] : []),
        r.addedBy,
        ...(r.removedBy == null ? [] : [r.removedBy]),
      ]),
      ...latest.map((r) => r.by),
      ...visible.flatMap((op) =>
        op.approvedBy == null ? [] : [op.approvedBy],
      ),
    ],
    proposal.reviewers,
  );
  return {
    userOf,
    header: toParticipantHeaderFields({
      role,
      purpose: proposal.purpose,
      reviewers: proposal.reviewers,
      latest,
      userOf,
      groupNameOf,
    }),
    decisionsOf: (op) =>
      toOperationDecisionViews({
        op,
        latest,
        requesterId: proposal.requester,
        userOf,
      }),
  };
};

const latestRevisionIdIn =
  (viewable: ViewablePages) =>
  (pageId: string): string | null => {
    const revision = viewable.pages.get(pageId)?.revision;
    return revision == null ? null : getIdStringForRef(revision);
  };

const pageViewIn =
  (viewable: ViewablePages) =>
  (op: OperationRecord): OperationView['page'] => {
    const pageId = targetPageIdOf(op);
    const page = pageId == null ? undefined : viewable.pages.get(pageId);
    return page == null
      ? undefined
      : { id: page._id.toString(), path: page.path };
  };

// Only operations this viewer could actually revert get a judgement, so the
// view never disagrees with what revert() would do for them (requirement 5.14).
const readRevertabilityOf = async (
  proposal: ChangeProposalDocument,
  visible: readonly OperationRecord[],
  viewable: ViewablePages,
  deleteAuthority: DeleteAuthority,
): Promise<(op: OperationRecord) => Revertability | undefined> => {
  const candidates = isRequesterAllowed(deleteAuthority.user)
    ? visible.filter((op) => REVERTIBILITY_STATUSES.has(op.status))
    : [];
  if (candidates.length === 0) {
    return () => undefined;
  }
  const factsOf = await loadCurrentPageFacts(
    candidates,
    viewable.pages,
    deleteAuthority,
  );
  const candidateKeys = new Set(candidates.map((op) => op.key));
  return (op) =>
    candidateKeys.has(op.key)
      ? judgeRevertability(op, proposal.entry, factsOf(op))
      : undefined;
};

type Relations = {
  readonly linked: readonly LinkedProposalRecord[];
  readonly base: ChangeProposalDocument | null;
};

// The requester's links all lead to their own proposals, so only other
// viewers need the base proposal read and the related proposals judged.
const readRelations = async (
  proposal: ChangeProposalDocument,
  isRequester: boolean,
): Promise<Relations> => {
  const [linked, base] = await Promise.all([
    prisma.changeproposals.findLinkedProposals(proposal._id),
    !isRequester && proposal.basedOn != null
      ? prisma.changeproposals.findProposal(proposal.basedOn.proposalId)
      : null,
  ]);
  return { linked, base };
};

const relatedToJudge = (
  { linked, base }: Relations,
  isRequester: boolean,
): readonly RelatedProposal[] =>
  isRequester
    ? []
    : [...linked, ...(base == null ? [] : [{ ...base, id: base._id }])];

const viewerRelations = (
  proposal: ChangeProposalDocument,
  { linked, base }: Relations,
  isRequester: boolean,
  { visible, relatedVisibleKeys }: ViewerScope,
): {
  readonly links: ReadonlyMap<string, readonly ProposalLinkView[]>;
  readonly basedOn?: BasedOn;
} => {
  const links = buildProposalLinks(
    visible.map((op) => op.key),
    toLinkedFacts(
      linked,
      (id) => isRequester || (relatedVisibleKeys.get(id)?.size ?? 0) > 0,
    ),
  );
  const basedOn =
    proposal.basedOn == null || isRequester
      ? proposal.basedOn
      : narrowBasedOn(
          proposal.basedOn,
          base == null ? undefined : relatedVisibleKeys.get(base._id),
        );
  return basedOn == null ? { links } : { links, basedOn };
};

const reviewTargetsOf = ({
  role,
  visible,
  scope,
  viewable,
}: ViewerScope): ReadonlyMap<string, ReviewTargetValues> =>
  role === 'reviewer'
    ? reviewTargetValuesOf(
        visible,
        scope.reviewTargetKeys,
        latestRevisionIdIn(viewable),
      )
    : new Map();

const toOperationViews = (
  viewerScope: ViewerScope,
  per: {
    readonly links: ReadonlyMap<string, readonly ProposalLinkView[]>;
    readonly revertabilityOf: (
      op: OperationRecord,
    ) => Revertability | undefined;
    readonly decisionsOf: (op: OperationRecord) => OperationDecisionViews;
  },
): OperationView[] => {
  const reviewTargets = reviewTargetsOf(viewerScope);
  const pageOf = pageViewIn(viewerScope.viewable);
  return viewerScope.visible.map((op) =>
    toOperationView(op, {
      role: viewerScope.role,
      page: pageOf(op),
      revertability: per.revertabilityOf(op),
      linkedProposals: per.links.get(op.key),
      reviewTarget: reviewTargets.get(op.key),
      decisions: per.decisionsOf(op),
    }),
  );
};

/**
 * Builds what one viewer may see of a proposal, by the viewer's role. Every
 * page involved — the proposal's, its follow-ups' and reworks', and its base's —
 * is checked in a single findByIdsAndViewer call, read the same way as a revert reads it.
 */
export const createProposalQuery = (deps: ProposalQueryDeps): ProposalQuery => {
  const reviewQueue = createReviewQueueQuery(deps.appliedListScan);
  return {
    ...createProposalListQuery(deps.appliedListScan),
    ...createRevisionMarksQuery(),
    async listReviewQueue(viewer, cursor, limit) {
      const identity = await loadViewerIdentity(viewer._id.toString());
      return reviewQueue.listReviewQueue(identity, cursor, limit);
    },
    async getForViewer(proposalId, viewer) {
      const proposal = await prisma.changeproposals.findProposal(proposalId);
      if (proposal == null) {
        return NOT_FOUND;
      }
      const viewerId = viewer._id.toString();
      const isRequester = proposal.requester === viewerId;

      const [relations, identity] = await Promise.all([
        readRelations(proposal, isRequester),
        loadViewerIdentity(viewerId),
      ]);
      const viewerScope = await readViewerScope(
        proposal,
        identity,
        relatedToJudge(relations, isRequester),
      );
      const { role, visible, viewable } = viewerScope;
      if (!isRequester && visible.length === 0) {
        return NOT_FOUND;
      }

      const [revertabilityOf, participant] = await Promise.all([
        readRevertabilityOf(proposal, visible, viewable, {
          user: viewer,
          services: deps.deletePermission,
        }),
        readParticipantViews(proposal, role, visible),
      ]);
      const { links, basedOn } = viewerRelations(
        proposal,
        relations,
        isRequester,
        viewerScope,
      );
      const operations = toOperationViews(viewerScope, {
        links,
        revertabilityOf,
        decisionsOf: participant.decisionsOf,
      });
      return {
        ok: true,
        value: {
          ...toProposalHeaderView({
            id: proposal._id,
            proposal,
            visible,
            role,
            requester: participant.userOf(proposal.requester),
            isPerPageNotificationsEnabled:
              readChangeProposalSettings().perPageNotificationsEnabled,
          }),
          ...participant.header,
          ...(basedOn == null ? {} : { basedOn }),
          operations,
        },
      };
    },
  };
};
