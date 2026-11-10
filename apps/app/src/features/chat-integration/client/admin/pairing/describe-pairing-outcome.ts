export type PairingOutcome =
  | { readonly status: 'paired'; readonly relationId: string }
  | { readonly status: 'relation-already-known'; readonly relationId: string }
  | { readonly status: 'already-paired'; readonly detail: string }
  | { readonly status: 'code-expired' }
  | { readonly status: 'ownership-unverified'; readonly detail: string }
  | { readonly status: 'call-failed'; readonly reason: string }
  | { readonly status: 'key-encryption-unconfigured' };

export const describePairingOutcome = (outcome: PairingOutcome): string => {
  switch (outcome.status) {
    case 'paired':
      return `Paired successfully (relation: ${outcome.relationId}).`;
    case 'relation-already-known':
      return 'This proxy already returned a relation this GROWI already has -- pairing was not established.';
    case 'already-paired':
      return `The proxy refused: ${outcome.detail}`;
    case 'code-expired':
      return 'The registration code has expired.';
    case 'ownership-unverified':
      return `The proxy could not verify this GROWI's URL: ${outcome.detail}`;
    case 'call-failed':
      return `Could not reach the proxy (${outcome.reason}).`;
    case 'key-encryption-unconfigured':
      return 'The encryption key is not configured -- pairing cannot start.';
    default:
      return 'Unknown outcome.';
  }
};
