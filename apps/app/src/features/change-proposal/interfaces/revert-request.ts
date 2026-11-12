export const REVERT_REQUEST_MESSAGE_MAX_LENGTH = 500;
export const REVERT_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type RevertRequestBody = { readonly message?: string };

export type ChangeProposalRevertRequestSnapshot = {
  readonly proposalId: string;
  readonly kind: 'revert-request';
  readonly sender: { readonly id: string; readonly username: string };
  // '' when omitted; plain text
  readonly message: string;
};

export const REVERT_REQUEST_ERROR_CODES = {
  ownProposal: 'own_proposal',
  requesterUnavailable: 'requester_unavailable',
  recentlySent: 'revert_request_recently_sent',
} as const;
