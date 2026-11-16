import { v5 as uuidv5 } from 'uuid';

// Fixed for the lifetime of the feature: changing it gives every chat
// conversation a new id, cutting it off from the AI thread it built so far.
const CONVERSATION_THREAD_NAMESPACE = '0e3f2b6a-5c1d-4f7e-9a8b-2d4c6e8f0a1b';

export interface ConversationThreadIdInput {
  readonly relationId: string;
  readonly userId: string;
  readonly conversationKey: string;
}

/**
 * The GROWI AI thread id of one user's conversation in one chat thread
 * (design.md ConversationThreadId). The parts are JSON-encoded as an array so
 * that no choice of characters inside a part can make two different inputs
 * produce the same name.
 */
export const conversationThreadIdOf = ({
  relationId,
  userId,
  conversationKey,
}: ConversationThreadIdInput): string =>
  uuidv5(
    JSON.stringify([relationId, userId, conversationKey]),
    CONVERSATION_THREAD_NAMESPACE,
  );
