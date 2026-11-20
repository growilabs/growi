export const REVERT_REQUEST_MESSAGE_MAX_LENGTH = 500;
export const REVERT_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Mirrors isLength of the validator library behind the server's
// express-validator chain, so client and server agree on the limit: a
// surrogate pair counts once, and so does a variation selector (U+FE0E/U+FE0F)
// right after a character that is not itself one.
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
const VARIATION_SELECTOR_AFTER_CHARACTER =
  /(?<!^|\uFE0E|\uFE0F)(?:\uFE0E|\uFE0F)/g;

export const countRevertRequestMessageLength = (message: string): number => {
  const surrogatePairs = message.match(SURROGATE_PAIR)?.length ?? 0;
  const variationSelectors =
    message.match(VARIATION_SELECTOR_AFTER_CHARACTER)?.length ?? 0;
  return message.length - surrogatePairs - variationSelectors;
};

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
