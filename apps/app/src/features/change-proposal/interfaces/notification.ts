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
