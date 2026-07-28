/**
 * Contract for the chat error text that crosses server → client.
 *
 * The server resolves a raw error to a SAFE message: for an AISDKError (a
 * provider/SDK-authored message such as "model X was not found. Did you mean
 * Y?") it forwards that message (collapsed to one line), never the stack /
 * responseBody / url, which can leak file paths, package versions and request
 * internals. Any other throwable (possibly GROWI-internal, so it may carry
 * secrets) collapses to {@link UNKNOWN_CHAT_ERROR}. The full error is only ever
 * logged server-side. The client shows the message and, for the sentinel, just
 * a generic heading.
 */

/** Sent when the error is not a recognizable AI SDK error. */
export const UNKNOWN_CHAT_ERROR = 'unknown';
