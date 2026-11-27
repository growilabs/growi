import type { InlineCommentAnchor } from '../../interfaces';
import {
  buildPrefixWindow,
  buildSuffixWindow,
  DEFAULT_TARGET_CONTEXT_WINDOW_SIZE,
} from '../../utils/context-window';
import {
  type MarkdownOccurrenceSelection,
  type MarkdownRange,
  selectMarkdownOccurrence,
} from './markdown-occurrence';
import {
  type RevisionBody,
  renderedTextOfRevision,
} from './rendered-text-cache';
import {
  NO_SOURCE,
  type RenderedTextWithSource,
  type SourceSpan,
} from './rendered-text-source-map';

export type MarkdownRangeAnchoring =
  | { readonly kind: 'anchored'; readonly anchor: InlineCommentAnchor }
  | { readonly kind: 'not-anchorable' };

export type MarkdownQuoteAnchorResolution =
  | MarkdownRangeAnchoring
  | Exclude<MarkdownOccurrenceSelection, { kind: 'selected' }>;

const overlaps = (span: SourceSpan, range: MarkdownRange): boolean =>
  span.start < range.end && span.end > range.start;

const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean =>
  code >= 0xdc00 && code <= 0xdfff;

/**
 * Builds the anchor for a markdown range from the rendered text: the quote
 * runs from the first to the last rendered character whose source overlaps
 * the range, so it is always a contiguous piece of the rendered text.
 */
export function anchorForMarkdownRange(
  rendered: RenderedTextWithSource,
  range: MarkdownRange,
): MarkdownRangeAnchoring {
  const { text, sourceStarts, sourceEnds, diagramBlocks } = rendered;
  if (diagramBlocks.some((block) => overlaps(block, range))) {
    return { kind: 'not-anchorable' };
  }

  // The same overlap test as `overlaps`, read straight from the typed arrays.
  const isInRange = (index: number): boolean =>
    sourceStarts[index] !== NO_SOURCE &&
    sourceStarts[index] < range.end &&
    sourceEnds[index] > range.start;
  let first = -1;
  for (let i = 0; i < sourceStarts.length && first === -1; i++) {
    if (isInRange(i)) first = i;
  }
  if (first === -1) {
    return { kind: 'not-anchorable' };
  }
  let last = first;
  for (let i = sourceStarts.length - 1; i > first; i--) {
    if (isInRange(i)) {
      last = i;
      break;
    }
  }
  if (first > 0 && isLowSurrogate(text.charCodeAt(first))) first--;
  if (last < text.length - 1 && isHighSurrogate(text.charCodeAt(last))) last++;

  const end = last + 1;
  const quote = text.slice(first, end);
  if (quote.trim() === '') {
    return { kind: 'not-anchorable' };
  }

  return {
    kind: 'anchored',
    anchor: {
      quote,
      prefix: buildPrefixWindow(
        text,
        first,
        DEFAULT_TARGET_CONTEXT_WINDOW_SIZE,
        'en',
      ),
      suffix: buildSuffixWindow(
        text,
        end,
        DEFAULT_TARGET_CONTEXT_WINDOW_SIZE,
        'en',
      ),
      approxOffset: first,
    },
  };
}

/**
 * Computes the anchor for an occurrence of `markdownQuote` in the page body
 * (requirement 26). `revision.body` must be the exact revision body: every
 * offset here indexes that string.
 */
export async function resolveMarkdownQuoteAnchor(
  revision: RevisionBody,
  markdownQuote: string,
  markdownOffset?: number,
): Promise<MarkdownQuoteAnchorResolution> {
  const selection = selectMarkdownOccurrence(
    revision.body,
    markdownQuote,
    markdownOffset,
  );
  if (selection.kind !== 'selected') {
    return selection;
  }

  return anchorForMarkdownRange(
    await renderedTextOfRevision(revision),
    selection.range,
  );
}
