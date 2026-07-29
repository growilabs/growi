import type { StorageThreadType } from '@mastra/core/memory';
import { DefaultChatTransport } from 'ai';

import { UNKNOWN_CHAT_ERROR } from '~/features/mastra/interfaces/chat-error';
import type { CustomUIMessage } from '~/features/mastra/interfaces/chat-message';

/**
 * Body sent with each message POST to `/_api/v3/mastra/message`.
 *
 * The chat is assistant-independent: only the thread identifier and the chosen
 * model key are sent so the server can create or resume the thread by
 * `resourceId` + `threadId` and resolve the effective model. No `aiAssistantId`
 * is included (see requirements 5.2, 8.3).
 *
 * `modelKey` is the opaque cross-provider composite key (`${provider}/${modelId}`)
 * the server validates against the available allow-list. It is optional: an absent
 * (or out-of-allowlist) value is rounded to the default server-side (Req 4.6), so
 * the body simply omits it when unknown.
 */
export type MastraMessageRequestBody = {
  threadId: string;
  modelKey?: string;
};

/**
 * Build the request body for a chat message send.
 *
 * Carries the thread identifier and (when known) the selected model key; never
 * an assistant identifier. `modelKey` is omitted when undefined so the server
 * falls back to the default model (Req 4.6).
 */
export const buildMessageRequestBody = (
  threadId: string,
  modelKey?: string,
): MastraMessageRequestBody => {
  return modelKey != null ? { threadId, modelKey } : { threadId };
};

/** API endpoint that backs the chat transport. */
const MASTRA_MESSAGE_API = '/_api/v3/mastra/message';

/**
 * Build the chat transport for a session.
 *
 * The threadId AND the selected modelKey are attached to EVERY outgoing request —
 * not just sendMessage. regenerate() (the error / message retry) sends no
 * per-call body, so without this the server would receive no threadId (minting a
 * brand-new thread on each retry) and no modelKey (dropping the user's model
 * choice on regenerate — Critical Issue 1, Req 4.7).
 *
 * The model is read LIVE per request via `getModelKey()` inside
 * `prepareSendMessagesRequest`, NOT baked into a static `body`. This is
 * essential: `@ai-sdk/react`'s `useChat` only re-creates its internal `Chat`
 * (which captures the transport) when the chat `id` changes — it ignores a
 * re-created `transport` instance. So a modelKey pinned at transport-creation
 * time would stick for the whole session: it would be absent whenever the
 * sidebar mounted before `/mastra/models` resolved, and later model-selector
 * changes would never reach the server. Reading the current selection through a
 * getter keeps every send/regenerate on the live model — including a mid-thread
 * switch to a DIFFERENT provider's model (Req 4.7) — regardless of when (or how
 * often) the model changes. The mechanism is unchanged from the single-provider
 * version; only the injected value is now a cross-provider modelKey.
 */
export const createMastraChatTransport = (
  threadId: string,
  getModelKey: () => string | undefined,
): DefaultChatTransport<CustomUIMessage> =>
  new DefaultChatTransport({
    api: MASTRA_MESSAGE_API,
    // `prepareSendMessagesRequest` REPLACES the whole request body, so we must
    // re-include the SDK's standard fields (id/messages/trigger/messageId — the
    // same set DefaultChatTransport sends by default) and then add the threadId
    // and the live modelKey on top.
    prepareSendMessagesRequest: ({
      body,
      id,
      messages,
      trigger,
      messageId,
    }) => ({
      body: {
        ...body,
        id,
        messages,
        trigger,
        messageId,
        ...buildMessageRequestBody(threadId, getModelKey()),
      },
    }),
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
