// The one way an `agent` request is finished, shared by the run and the
// stale-row sweep (design.md 依頼の行の状態): store the answer, then finish the
// row while it is still running. The unique answer index decides a race
// between the two writers, so exactly one answer exists per request.

import type { AgentAnswer } from '@growi/chat';

import type { ChatOutbox } from '../outbox';
import type { ChatAgentRequestModel } from './models/chat-agent-request';

export interface RecordAgentAnswerDeps {
  readonly outbox: ChatOutbox;
  readonly requests: Pick<ChatAgentRequestModel, 'updateOne'>;
}

export interface AgentRequestIds {
  readonly relationId: string;
  readonly requestId: string;
}

export type RecordedAgentAnswer =
  /** This writer's answer is stored and the row is finished. */
  | { readonly outcome: 'stored' }
  /** Another writer answered first; only the row is finished. */
  | { readonly outcome: 'already-stored' }
  /** Nothing changed: the row stays running for the next sweep. */
  | { readonly outcome: 'not-stored'; readonly error: unknown };

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 11000;

const storeAnswer = async (
  outbox: ChatOutbox,
  { relationId, requestId }: AgentRequestIds,
  answer: AgentAnswer,
): Promise<RecordedAgentAnswer> => {
  try {
    await outbox.enqueue({
      kind: 'command-answer',
      relationId,
      requestId,
      answer,
    });
    return { outcome: 'stored' };
  } catch (error) {
    return isDuplicateKeyError(error)
      ? { outcome: 'already-stored' }
      : { outcome: 'not-stored', error };
  }
};

/**
 * A row finished without an answer would leave the person unanswered, so a
 * failed store leaves the row as it is. A failure to finish the row rejects;
 * the answer is stored by then, so the next sweep only finishes the row.
 */
export const recordAgentAnswer = async (
  deps: RecordAgentAnswerDeps,
  ids: AgentRequestIds,
  answer: AgentAnswer,
): Promise<RecordedAgentAnswer> => {
  const stored = await storeAnswer(deps.outbox, ids, answer);
  if (stored.outcome === 'not-stored') return stored;
  await deps.requests.updateOne(
    { relationId: ids.relationId, requestId: ids.requestId, state: 'running' },
    { state: 'done' },
  );
  return stored;
};
