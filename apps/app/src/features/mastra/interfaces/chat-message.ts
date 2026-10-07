import type { UIDataTypes, UIMessage } from 'ai';

import type { GrowiChatTools } from './chat-tools';

/**
 * Metadata the server attaches to an assistant message when its stream finishes.
 *
 * Written once per response via `writer.write({ type: 'message-metadata', ... })`
 * in the post-message route, and surfaced on the client as `message.metadata`.
 * `finishReason` mirrors the resolved `stream.finishReason`, which the agent
 * stream types as `string | undefined`.
 */
export type CustomUIMessageMetadata = {
  finishReason?: string;
};

/**
 * GROWI's chat message shape: the AI SDK `UIMessage` specialized with GROWI's
 * message metadata AND tool set. Shared by the server stream writer
 * (`createUIMessageStream`) and the client (`useChat` / transport / saved-message
 * store) so both message metadata and tool-result parts stay type-safe end to
 * end — a `tool-getPageContentTool` part's `output` is statically typed, no
 * runtime shape-narrowing needed (see client/.../page-sources.ts).
 */
export type CustomUIMessage = UIMessage<
  CustomUIMessageMetadata,
  UIDataTypes,
  GrowiChatTools
>;
