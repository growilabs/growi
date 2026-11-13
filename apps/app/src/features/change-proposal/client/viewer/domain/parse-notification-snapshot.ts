import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';

import { SupportedAction } from '~/interfaces/activity';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const readUsername = (value: unknown): string | null =>
  isRecord(value) && typeof value.username === 'string' ? value.username : null;

const readPagePaths = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const paths: string[] = [];
  for (const page of value) {
    if (!isRecord(page) || typeof page.path !== 'string') {
      return null;
    }
    paths.push(page.path);
  }
  return paths;
};

const readCoalesced = (
  kind: 'apply' | 'revert',
  proposalId: string,
  body: Record<string, unknown>,
): ParsedChangeProposalNotification | null => {
  const actorUsername = readUsername(body.requester);
  const pagePaths = readPagePaths(body.pages);
  if (actorUsername == null || pagePaths == null) {
    return null;
  }
  return { kind, proposalId, actorUsername, pagePaths };
};

const readRevertRequest = (
  proposalId: string,
  body: Record<string, unknown>,
): ParsedChangeProposalNotification | null => {
  const senderUsername = readUsername(body.sender);
  if (
    body.kind !== 'revert-request' ||
    senderUsername == null ||
    typeof body.message !== 'string'
  ) {
    return null;
  }
  return {
    kind: 'revert-request',
    proposalId,
    senderUsername,
    message: body.message,
  };
};

const parseJson = (snapshot: unknown): unknown => {
  if (typeof snapshot !== 'string') {
    return null;
  }
  try {
    return JSON.parse(snapshot);
  } catch {
    return null;
  }
};

export const parseChangeProposalNotification = (
  action: string,
  snapshot: unknown,
): ParsedChangeProposalNotification | null => {
  const body = parseJson(snapshot);
  if (!isRecord(body)) {
    return null;
  }
  const { proposalId } = body;
  if (typeof proposalId !== 'string' || !isValidObjectId(proposalId)) {
    return null;
  }

  switch (action) {
    case SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY:
      return body.kind === 'apply'
        ? readCoalesced('apply', proposalId, body)
        : null;
    case SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT:
      return body.kind === 'revert'
        ? readCoalesced('revert', proposalId, body)
        : null;
    case SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST:
      return readRevertRequest(proposalId, body);
    default:
      return null;
  }
};
