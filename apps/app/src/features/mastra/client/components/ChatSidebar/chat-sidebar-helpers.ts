import type { StorageThreadType } from '@mastra/core/memory';

import { UNKNOWN_CHAT_ERROR } from '~/features/mastra/interfaces/chat-error';

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
 * Resolve the chat header label.
 *
 * Prefers the title of the current thread (looked up in the recent-threads
 * list by id); falls back to the given label when the thread or its title is
 * not yet available (e.g. a brand-new chat whose title has not been generated
 * yet). The caller passes a localized fallback so this stays a pure function.
 * The header never depends on assistant data.
 */
export const resolveChatHeaderLabel = (
  threadId: string,
  threads: readonly StorageThreadType[],
  fallbackLabel: string,
): string => {
  const title = threads.find((thread) => thread.id === threadId)?.title;
  return title != null && title !== '' ? title : fallbackLabel;
};

/**
 * The chat error detail to display, or undefined (→ show just the heading).
 *
 * The server already resolved a safe message (an AISDKError's provider message,
 * one line — or the "unknown" sentinel) and it arrives as the client error's
 * `.message`, so no re-sanitizing is needed here. We only decide whether to show
 * it: hide the sentinel, the empty string, and any structured body (JSON/HTML)
 * — which only the rare pre-stream HTTP-error path (raw transport text) can
 * produce — so a non-human-readable string is never rendered.
 */
export const resolveChatErrorDetail = (
  error: Error | undefined,
): string | undefined => {
  const detail = error?.message?.trim();
  if (
    detail == null ||
    detail === '' ||
    detail === UNKNOWN_CHAT_ERROR ||
    /^[{[<]/.test(detail)
  ) {
    return undefined;
  }
  return detail;
};
