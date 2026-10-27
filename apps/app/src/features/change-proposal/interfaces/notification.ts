import type { ProposalEntry } from './change-proposal';

export type ChangeProposalNotificationSnapshot = {
  readonly proposalId: string;
  readonly entry: ProposalEntry;
  readonly kind: 'apply' | 'revert';
  readonly requester: { readonly id: string; readonly username: string };
  // Only pages this recipient can view.
  readonly pages: readonly { readonly id: string; readonly path: string }[];
};
