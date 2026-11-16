import type {
  ApprovalView,
  ChangeProposalView,
  OperationRecord,
  ReviewDecisionView,
  ReviewerKind,
  ReviewerRef,
  ReviewerView,
  ReviewRecord,
  UserSummary,
  ViewerRole,
} from '../../interfaces';

export type UserSummaryOf = (userId: string) => UserSummary;
export type GroupNameOf = (
  kind: Exclude<ReviewerKind, 'user'>,
  id: string,
) => string;

export type OperationDecisionViews = {
  readonly approval?: ApprovalView;
  readonly rejections?: readonly ReviewDecisionView[];
  readonly abstentions?: readonly ReviewDecisionView[];
};

export type ReviewTargetValues = {
  readonly order: number;
  readonly baseIsLatest?: boolean;
};

export type ParticipantHeaderFields = Pick<
  ChangeProposalView,
  'purpose' | 'reviewers' | 'wholeRejections'
>;

const recordSlot = (record: ReviewRecord): string =>
  `${record.by}\u0000${record.operationKey ?? ''}`;

/**
 * One record per person and key (or the whole proposal): the newest, whatever
 * its kind. Two concurrent decisions by the same person can both be stored.
 */
export const latestReviews = (
  reviews: readonly ReviewRecord[],
): readonly ReviewRecord[] => {
  const latest = new Map<string, ReviewRecord>();
  for (const record of reviews) {
    const kept = latest.get(recordSlot(record));
    if (kept == null || record.at >= kept.at) {
      latest.set(recordSlot(record), record);
    }
  }
  return [...latest.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
};

const toDecisionView = (
  record: ReviewRecord,
  userOf: UserSummaryOf,
): ReviewDecisionView => ({
  by: userOf(record.by),
  at: record.at.toISOString(),
  ...(record.comment == null ? {} : { comment: record.comment }),
});

const toApprovalView = (
  op: Pick<OperationRecord, 'approvedAt' | 'approvedBy' | 'approvedChannel'>,
  requesterId: string,
  userOf: UserSummaryOf,
): ApprovalView | undefined =>
  op.approvedAt == null || op.approvedBy == null || op.approvedChannel == null
    ? undefined
    : {
        by: userOf(op.approvedBy),
        at: op.approvedAt.toISOString(),
        channel: op.approvedChannel,
        byRequester: op.approvedBy === requesterId,
      };

/** The decision records on one operation; `latest` comes from latestReviews. */
export const toOperationDecisionViews = (args: {
  readonly op: OperationRecord;
  readonly latest: readonly ReviewRecord[];
  readonly requesterId: string;
  readonly userOf: UserSummaryOf;
}): OperationDecisionViews => {
  const { op, latest, userOf } = args;
  const onOperation = latest.filter((r) => r.operationKey === op.key);
  const viewsOf = (kind: ReviewRecord['kind']) =>
    onOperation
      .filter((r) => r.kind === kind)
      .map((r) => toDecisionView(r, userOf));
  const approval = toApprovalView(op, args.requesterId, userOf);
  const rejections = viewsOf('reject');
  const abstentions = viewsOf('abstain');
  return {
    ...(approval == null ? {} : { approval }),
    ...(rejections.length === 0 ? {} : { rejections }),
    ...(abstentions.length === 0 ? {} : { abstentions }),
  };
};

const toReviewerView = (
  reviewer: ReviewerRef,
  userOf: UserSummaryOf,
  groupNameOf: GroupNameOf,
): ReviewerView => ({
  kind: reviewer.kind,
  id: reviewer.id,
  name:
    reviewer.kind === 'user'
      ? userOf(reviewer.id).username
      : groupNameOf(reviewer.kind, reviewer.id),
  addedBy: userOf(reviewer.addedBy),
  addedAt: reviewer.addedAt.toISOString(),
  ...(reviewer.removedBy == null
    ? {}
    : { removedBy: userOf(reviewer.removedBy) }),
  ...(reviewer.removedAt == null
    ? {}
    : { removedAt: reviewer.removedAt.toISOString() }),
});

/**
 * The proposal-level fields only participants get: the purpose and reviewers
 * for the requester and reviewers, whole-proposal rejections for the requester
 * alone (Reviewers Req 3.8, 5.7, 5.8).
 */
export const toParticipantHeaderFields = (args: {
  readonly role: ViewerRole;
  readonly purpose?: string;
  readonly reviewers: readonly ReviewerRef[];
  readonly latest: readonly ReviewRecord[];
  readonly userOf: UserSummaryOf;
  readonly groupNameOf: GroupNameOf;
}): ParticipantHeaderFields => {
  const { role, purpose, userOf } = args;
  if (role === 'other') {
    return {};
  }
  return {
    ...(purpose == null ? {} : { purpose }),
    reviewers: args.reviewers.map((r) =>
      toReviewerView(r, userOf, args.groupNameOf),
    ),
    ...(role === 'requester'
      ? {
          wholeRejections: args.latest
            .filter((r) => r.operationKey == null && r.kind === 'reject')
            .map((r) => toDecisionView(r, userOf)),
        }
      : {}),
  };
};

/**
 * A reviewer's values on each decision target: its rank among all the visible
 * operations (never the stored index, whose gaps would count hidden ones) and,
 * for an edit, whether its base is still the page's latest revision.
 */
export const reviewTargetValuesOf = (
  visible: readonly OperationRecord[],
  reviewTargetKeys: ReadonlySet<string>,
  latestRevisionIdOf: (pageId: string) => string | null,
): ReadonlyMap<string, ReviewTargetValues> =>
  new Map(
    [...visible]
      .sort((a, b) => a.index - b.index)
      .flatMap((op, order) => {
        if (!reviewTargetKeys.has(op.key)) {
          return [];
        }
        const values: ReviewTargetValues =
          op.type === 'edit'
            ? {
                order,
                baseIsLatest:
                  latestRevisionIdOf(op.pageId) === op.baseRevisionId,
              }
            : { order };
        return [[op.key, values] as const];
      }),
  );
