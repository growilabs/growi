import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalView,
  OperationRecord,
  RequesterProposalState,
} from '../../interfaces';
import {
  computeAchievement,
  deriveProposalStatus,
  targetPageIdOf,
  type VisibilityContext,
  type VisibilityOperationFacts,
} from '../domain';
import type { ViewablePages } from './current-page-facts';
import {
  type RevertCounterpartFacts,
  type RevertCounterpartSource,
  type RevertCounterpartValues,
  revertCounterpartFactsOf,
  revertCounterpartIdsOf,
} from './revert-counterparts';

export type RequesterView = ChangeProposalView['requester'];

// What a proposal view and a list summary share: everything but operations, links and pages.
export type ProposalHeaderView = Omit<
  ChangeProposalView,
  'operations' | 'basedOn'
>;

type HeaderFacts = Pick<
  ChangeProposalDocument,
  | 'entry'
  | 'modelLabel'
  | 'createdAt'
  | 'lastAppliedAt'
  | 'lifecycle'
  | 'revertOf'
  | 'perPageNotifications'
>;

type VisibleOperationFacts = Pick<
  OperationRecord,
  'status' | 'reason' | 'appliedAt'
>;

const userModel = () => mongoose.model<IUserHasId>('User');

export const pageIdsOf = (
  operations: readonly VisibilityOperationFacts[],
): string[] =>
  operations.flatMap((op) => {
    const pageId = targetPageIdOf(op);
    return pageId == null ? [] : [pageId];
  });

export const contextFor = (
  requesterId: string,
  viewerId: string,
  viewable: ViewablePages,
  counterpart: RevertCounterpartValues,
): VisibilityContext => ({
  isRequester: requesterId === viewerId,
  isOriginalRequester: counterpart.isOriginalRequester,
  revertProposalIdsByViewer: counterpart.revertProposalIdsByViewer,
  viewablePageIds: viewable.viewablePageIds,
  anyoneWithLinkPageIds: viewable.anyoneWithLinkPageIds,
  deletedPageIds: viewable.deletedPageIds,
});

/**
 * Reads the revert counterparts of every proposal about to be filtered in one
 * query, then answers each proposal's counterpart values and create paths.
 */
export const loadRevertCounterparts = async (
  proposals: readonly RevertCounterpartSource[],
  viewerId: string,
  deletedPageIds: ReadonlySet<string>,
): Promise<(proposal: RevertCounterpartSource) => RevertCounterpartFacts> => {
  const ids = revertCounterpartIdsOf(proposals, deletedPageIds);
  const records =
    ids.length === 0
      ? []
      : await prisma.changeproposals.findRevertCounterparts(ids);
  const byId = new Map(records.map((record) => [record.id, record]));
  return (proposal) =>
    revertCounterpartFactsOf(proposal, viewerId, byId, deletedPageIds);
};

// The newest appliedAt among the returned operations; the stored value may come
// from an operation the viewer must not learn about (requirement 9.10).
const newestAppliedAt = (
  operations: readonly VisibleOperationFacts[],
): Date | undefined =>
  operations.reduce<Date | undefined>(
    (newest, op) =>
      op.appliedAt != null && (newest == null || op.appliedAt > newest)
        ? op.appliedAt
        : newest,
    undefined,
  );

const requesterStateOf = (
  proposal: HeaderFacts,
  visible: readonly VisibleOperationFacts[],
  isPerPageNotificationsEnabled: boolean,
): RequesterProposalState => {
  const achievement = computeAchievement(proposal.entry, visible);
  return {
    lifecycle: proposal.lifecycle,
    ...(achievement == null ? {} : { achievement }),
    perPageNotifications: {
      value: proposal.perPageNotifications,
      isEnabledBySettings: isPerPageNotificationsEnabled,
    },
  };
};

/** Reads every requester in one query; a deleted user reads as empty names. */
export const readRequesters = async (
  requesterIds: readonly string[],
): Promise<(requesterId: string) => RequesterView> => {
  const unique = [...new Set(requesterIds)];
  const users =
    unique.length === 0
      ? []
      : await userModel()
          .find({ _id: { $in: unique } }, { username: 1, name: 1 })
          .lean();
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  return (requesterId) => {
    const user = byId.get(requesterId);
    return {
      id: requesterId,
      username: user?.username ?? '',
      name: user?.name ?? '',
    };
  };
};

/**
 * The fields a viewer sees of a proposal itself. Status, achievement and (for
 * non-requesters) lastAppliedAt come from the visible operations only, so
 * nothing counts or dates an operation the viewer may not see (requirements 9.4, 9.10).
 */
export const toProposalHeaderView = (args: {
  readonly id: string;
  readonly proposal: HeaderFacts;
  readonly visible: readonly VisibleOperationFacts[];
  readonly isRequester: boolean;
  readonly requester: RequesterView;
  readonly isPerPageNotificationsEnabled: boolean;
}): ProposalHeaderView => {
  const { id, proposal, visible, isRequester } = args;
  const lastAppliedAt = isRequester
    ? proposal.lastAppliedAt
    : newestAppliedAt(visible);
  return {
    id,
    requester: args.requester,
    entry: proposal.entry,
    ...(proposal.modelLabel == null ? {} : { modelLabel: proposal.modelLabel }),
    createdAt: proposal.createdAt.toISOString(),
    ...(lastAppliedAt == null
      ? {}
      : { lastAppliedAt: lastAppliedAt.toISOString() }),
    status: deriveProposalStatus(proposal.lifecycle, visible),
    isRequester,
    ...(proposal.revertOf == null ? {} : { revertOf: proposal.revertOf }),
    ...(isRequester
      ? {
          requesterState: requesterStateOf(
            proposal,
            visible,
            args.isPerPageNotificationsEnabled,
          ),
        }
      : {}),
  };
};
