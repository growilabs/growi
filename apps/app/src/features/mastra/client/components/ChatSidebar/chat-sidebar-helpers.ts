import type { StorageThreadType } from '@mastra/core/memory';

/**
 * Body sent with each message POST to `/_api/v3/mastra/message`.
 *
 * The chat is assistant-independent: only the thread identifier is sent so the
 * server can create or resume the thread by `resourceId` + `threadId`. No
 * `aiAssistantId` is included (see requirements 5.2, 8.3).
 */
export type MastraMessageRequestBody = {
  threadId: string;
};

/**
 * Build the request body for a chat message send.
 *
 * Carries only the thread identifier; never an assistant identifier.
 */
export const buildMessageRequestBody = (
  threadId: string,
): MastraMessageRequestBody => {
  return { threadId };
};

/**
 * Generic fallback label shown in the chat header when no thread title is
 * available (e.g. a brand-new chat whose title has not been generated yet).
 */
export const GENERIC_CHAT_HEADER_LABEL = 'AI Chat';

/**
 * Resolve the chat header label.
 *
 * Prefers the title of the current thread (looked up in the recent-threads
 * list by id); falls back to a generic label when the thread or its title is
 * not yet available. The header never depends on assistant data.
 */
export const resolveChatHeaderLabel = (
  threadId: string,
  threads: readonly StorageThreadType[],
): string => {
  const title = threads.find((thread) => thread.id === threadId)?.title;
  return title != null && title !== '' ? title : GENERIC_CHAT_HEADER_LABEL;
};
