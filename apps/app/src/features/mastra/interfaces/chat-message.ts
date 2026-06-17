import type { UIMessage } from 'ai';

/**
 * Metadata the server attaches to an assistant message when its stream finishes.
 *
 * Written once per response via `writer.write({ type: 'message-metadata', ... })`
 * in the post-message route, and surfaced on the client as `message.metadata`.
 * `finishReason` mirrors the resolved `stream.finishReason`, which the agent
 * stream types as `string | undefined`.
 */
export type MastraMessageMetadata = {
  finishReason?: string;
};

/**
 * GROWI's chat message shape: the AI SDK `UIMessage` specialized with GROWI's
 * message metadata. Shared by the server stream writer (`createUIMessageStream`)
 * and the client (`useChat` / transport / saved-message store) so message
 * metadata stays type-safe end to end.
 */
export type MastraUIMessage = UIMessage<MastraMessageMetadata>;
