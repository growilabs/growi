import type { StorageThreadType } from '@mastra/core/memory';
import { DefaultChatTransport } from 'ai';

import { UNKNOWN_CHAT_ERROR } from '~/features/mastra/interfaces/chat-error';
import type { CustomUIMessage } from '~/features/mastra/interfaces/chat-message';

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

/** API endpoint that backs the chat transport. */
const MASTRA_MESSAGE_API = '/_api/v3/mastra/message';

/**
 * Build the chat transport for a session.
 *
 * The threadId is pinned on the transport `body` so EVERY request carries it —
 * not just sendMessage. regenerate() (the error / message retry) sends no
 * per-call body, so without this the server would receive no threadId and mint
 * a brand-new thread on each retry.
 */
export const createMastraChatTransport = (
  threadId: string,
): DefaultChatTransport<CustomUIMessage> =>
  new DefaultChatTransport({
    api: MASTRA_MESSAGE_API,
    body: buildMessageRequestBody(threadId),
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

/**
 * i18n key suffix under `ai_sidebar.incomplete.*` for an abnormally-finished
 * assistant message. Mirrors the finish reasons we give distinct copy to; every
 * other / unrecognized reason collapses to `unknown`.
 */
type IncompleteReasonKey =
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error'
  | 'unknown';

/**
 * Map a message's `finishReason` to the notice key, or `null` when no notice
 * should show (normal `stop`, or an absent reason — still streaming / a legacy
 * message that predates metadata).
 *
 * The reason arrives as a plain string: Mastra widens `stream.finishReason` to
 * `string | undefined` (the precise `MastraFinishReason` union is not carried on
 * that accessor), so this narrows it at runtime. Reasons beyond the standard
 * provider set — e.g. Mastra's `tripwire` / `retry`, or a future `unknown` —
 * fall through to the generic message.
 */
export const resolveIncompleteReasonKey = (
  finishReason: string | undefined,
): IncompleteReasonKey | null => {
  switch (finishReason) {
    case undefined:
    case '':
    case 'stop':
      return null;
    case 'length':
      return 'length';
    case 'tool-calls':
      return 'tool_calls';
    case 'content-filter':
      return 'content_filter';
    case 'error':
      return 'error';
    default:
      return 'unknown';
  }
};
