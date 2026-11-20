import type { FullTextSearchToolOutput } from '~/features/mastra/server/services/mastra-modules/tools/full-text-search-tool';
import type { GetPageContentToolOutput } from '~/features/mastra/server/services/mastra-modules/tools/get-page-content-tool';

/**
 * The GROWI agent's tool set, typed for the AI SDK `UIMessage` `TOOLS` generic.
 *
 * Keyed by the agent's tool *registration keys* (growi-agent.ts) — the AI SDK
 * derives the message-part type as `tool-<key>` (e.g. `tool-getPageContentTool`),
 * so a typed message lets consumers read `part.output` statically instead of
 * narrowing an opaque `unknown`.
 *
 * Only `output` is modelled (the client reads tool *results*, not inputs). The
 * output types are inferred from each tool's Zod `outputSchema` — a single
 * source of truth shared with the server — and imported **type-only**, so no
 * server runtime code reaches the client bundle. Conformance to AI SDK's
 * `UITools` is enforced where this is passed to `UIMessage<…>` in
 * chat-message.ts.
 */
export type GrowiChatTools = {
  getPageContentTool: { input: unknown; output: GetPageContentToolOutput };
  fullTextSearchTool: { input: unknown; output: FullTextSearchToolOutput };
};
