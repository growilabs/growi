export type ParsedChangeProposalNotification =
  | {
      readonly kind: 'apply' | 'revert';
      readonly proposalId: string;
      readonly actorUsername: string;
      readonly pagePaths: readonly string[];
    }
  | {
      readonly kind: 'revert-request';
      readonly proposalId: string;
      readonly senderUsername: string;
      readonly message: string;
    };

export const parseChangeProposalNotification = (
  _action: string,
  _snapshot: unknown,
): ParsedChangeProposalNotification | null => {
  throw new Error('Not implemented');
};
