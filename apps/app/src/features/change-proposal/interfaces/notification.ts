import type { ProposalEntry } from './change-proposal';

export type ChangeProposalNotificationSnapshot = {
  readonly proposalId: string;
  readonly entry: ProposalEntry;
  readonly kind: 'apply' | 'revert';
  readonly requester: { readonly id: string; readonly username: string };
  // Only pages this recipient can view, plus, for the original requester of a
  // revert, the pages it created that the revert deleted completely.
  readonly pages: readonly { readonly id: string; readonly path: string }[];
};

export type ReviewRequestNotificationSnapshot = {
  readonly kind: 'review-request';
  readonly proposalId: string;
  readonly requester: { readonly id: string; readonly username: string };
  readonly pages: readonly { readonly id: string; readonly path: string }[];
};

export type ReviewResultNotificationSnapshot = {
  readonly kind: 'review-result';
  readonly proposalId: string;
  readonly reviewer: { readonly id: string; readonly username: string };
  readonly items: readonly {
    readonly path: string;
    readonly result: 'approved' | 'rejected' | 'abstained';
    readonly comment?: string;
  }[];
  // Present when the request recorded a whole-proposal rejection (the comment may be absent).
  readonly wholeRejection?: { readonly comment?: string };
};

export type AnyChangeProposalNotificationSnapshot =
  | ChangeProposalNotificationSnapshot
  | ReviewRequestNotificationSnapshot
  | ReviewResultNotificationSnapshot;
