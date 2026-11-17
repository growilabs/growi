const SHORT_ID_LENGTH = 8;

export const formatProposalShortId = (proposalId: string): string =>
  `#${proposalId.slice(-SHORT_ID_LENGTH)}`;

// The detail page route is owned by change-proposal-viewer; build every link here, never inline the URL.
export const buildProposalHref = (proposalId: string): string =>
  `/me/change-proposals/${proposalId}`;
