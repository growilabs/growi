import type { StorageThreadType } from '@mastra/core/memory';
import { DefaultChatTransport, type UIMessage } from 'ai';

import { UNKNOWN_CHAT_ERROR } from '~/features/mastra/interfaces/chat-error';

/**
 * Body sent with each message POST to `/_api/v3/mastra/message`.
 *
 * The chat is assistant-independent: only the thread identifier and the chosen
 * model id are sent so the server can create or resume the thread by
 * `resourceId` + `threadId` and resolve the effective model. No `aiAssistantId`
 * is included (see requirements 5.2, 8.3).
 *
 * `modelId` is optional: an absent (or out-of-allowlist) value is rounded to the
 * default server-side (Req 4.2/4.3), so the body simply omits it when unknown.
 */
export type MastraMessageRequestBody = {
  threadId: string;
  modelId?: string;
};

/**
 * Build the request body for a chat message send.
 *
 * Carries the thread identifier and (when known) the selected model id; never
 * an assistant identifier. `modelId` is omitted when undefined so the server
 * falls back to the default model (Req 4.3).
 */
export const buildMessageRequestBody = (
  threadId: string,
  modelId?: string,
): MastraMessageRequestBody => {
  return modelId != null ? { threadId, modelId } : { threadId };
};

/** API endpoint that backs the chat transport. */
const MASTRA_MESSAGE_API = '/_api/v3/mastra/message';

/**
 * Build the chat transport for a session.
 *
 * Both the threadId AND the selected modelId are pinned on the transport `body`
 * so EVERY request carries them — not just sendMessage. regenerate() (the error
 * / message retry) sends no per-call body, so without this the server would
 * receive no threadId (minting a brand-new thread on each retry) and no modelId
 * (dropping the user's model choice on regenerate — Critical Issue 1, Req
 * 3.3/3.4). The caller re-creates the transport when the model changes so the
 * pinned modelId always reflects the current selection.
 */
export const createMastraChatTransport = (
  threadId: string,
  modelId?: string,
): DefaultChatTransport<UIMessage> =>
  new DefaultChatTransport({
    api: MASTRA_MESSAGE_API,
    body: buildMessageRequestBody(threadId, modelId),
  });

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
