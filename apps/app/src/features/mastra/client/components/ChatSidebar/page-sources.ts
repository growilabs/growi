import type { CustomUIMessage } from '~/features/mastra/interfaces/chat-message';

/**
 * A wiki page the assistant opened while answering, surfaced to the user as a
 * navigable "source". Derived purely from the message parts — no extra model
 * call and no server round-trip.
 */
export type PageSource = {
  pageId: string;
  path: string;
};

/**
 * Extract the deduplicated list of pages the assistant read (via
 * getPageContent) from a message's parts.
 *
 * Because the chat message is typed (`CustomUIMessage` carries the agent's tool
 * set), a `tool-getPageContentTool` part's `output` is **statically typed**
 * here — no runtime shape-narrowing is needed, only a discriminant check on
 * `result`. The full-text search tool is a different part type, so it is
 * excluded by the type, not by inspection.
 *
 * Works identically for a live stream and for a thread reloaded from memory:
 * both surface the same `output-available` tool parts (the reload path goes
 * through `convertMessages(...).to('AIV5.UI')`), so the source list survives a
 * page reload without any extra persistence.
 *
 * Deduplicates by `pageId` because the agent typically calls getPageContent
 * more than once for the same page (outline first, then a section drill-down).
 */
export const extractPageSources = (
  parts: CustomUIMessage['parts'],
): PageSource[] => {
  const seen = new Set<string>();
  const sources: PageSource[] = [];

  for (const part of parts) {
    if (part.type !== 'tool-getPageContentTool') continue;
    if (part.state !== 'output-available') continue;

    const { output } = part; // statically typed: GetPageContentToolOutput
    if (output.result !== 'ok') continue;

    const { pageId, path } = output.page;
    // `pageId` is typed `string`, but a thread persisted before the field was
    // added would lack it at runtime — guard so we never emit a "/undefined"
    // link for such out-of-contract legacy data.
    if (pageId == null) continue;
    if (seen.has(pageId)) continue;

    seen.add(pageId);
    sources.push({ pageId, path });
  }

  return sources;
};
