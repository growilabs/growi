import { AISDKError } from 'ai';

import { UNKNOWN_CHAT_ERROR } from '~/features/mastra/interfaces/chat-error';

// Collapse all whitespace (drops newlines and any pseudo-stack the provider may
// have embedded) and trim. No length cap — operators want the full provider
// message (e.g. a "did you mean ...?" hint).
const sanitize = (message: string): string =>
  message.replace(/\s+/g, ' ').trim();

/**
 * Resolve a safe, client-displayable message for a chat error.
 *
 * For an AISDKError the message is SDK/provider-authored (e.g. "model X was not
 * found. Did you mean Y?") — useful and free of GROWI secrets/API keys — so it
 * is forwarded (one line). The stack / responseBody / url are never forwarded
 * (logged server-side only). Any other throwable could be GROWI-internal and
 * carry secrets, so it collapses to {@link UNKNOWN_CHAT_ERROR}.
 */
export const resolveChatErrorMessage = (error: unknown): string => {
  if (!AISDKError.isInstance(error)) {
    return UNKNOWN_CHAT_ERROR;
  }
  const message = sanitize(error.message);
  return message === '' ? UNKNOWN_CHAT_ERROR : message;
};
