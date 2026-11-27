import {
  buildPrefixWindow,
  buildSuffixWindow,
} from '../../utils/context-window';

/** A [start, end) range of UTF-16 code units in the page body markdown. */
export interface MarkdownRange {
  readonly start: number;
  readonly end: number;
}

export interface MarkdownOccurrenceCandidate {
  /** UTF-16 index in the body where the occurrence starts. */
  readonly offset: number;
  /** 1-based line number of `offset`. */
  readonly line: number;
  /** The occurrence (truncated when long) with a little of the markdown around it. */
  readonly snippet: string;
}

export type MarkdownOccurrenceSelection =
  | { readonly kind: 'selected'; readonly range: MarkdownRange }
  | { readonly kind: 'not-found' }
  | {
      readonly kind: 'ambiguous' | 'offset-mismatch';
      /** The first occurrences in document order, at most MAX_CANDIDATES. */
      readonly candidates: readonly MarkdownOccurrenceCandidate[];
      /** How many occurrences there are in all. */
      readonly total: number;
    };

export const MAX_CANDIDATES = 20;
const SNIPPET_CONTEXT_SIZE = 20;
const SNIPPET_MATCH_SIZE = 40;

/** Start offsets of the non-overlapping occurrences, in document order. */
function findOccurrenceOffsets(body: string, quote: string): number[] {
  const offsets: number[] = [];
  for (
    let found = body.indexOf(quote);
    found !== -1;
    found = body.indexOf(quote, found + quote.length)
  ) {
    offsets.push(found);
  }
  return offsets;
}

function toCandidates(
  body: string,
  quote: string,
  offsets: readonly number[],
): MarkdownOccurrenceCandidate[] {
  const candidates: MarkdownOccurrenceCandidate[] = [];
  let line = 1;
  let countedUpTo = 0;
  for (const offset of offsets) {
    for (
      let newline = body.indexOf('\n', countedUpTo);
      newline !== -1 && newline < offset;
      newline = body.indexOf('\n', newline + 1)
    ) {
      line++;
    }
    countedUpTo = offset;

    const match =
      quote.length > SNIPPET_MATCH_SIZE
        ? `${buildSuffixWindow(body, offset, SNIPPET_MATCH_SIZE, 'en')}…`
        : quote;
    candidates.push({
      offset,
      line,
      snippet:
        buildPrefixWindow(body, offset, SNIPPET_CONTEXT_SIZE, 'en') +
        match +
        buildSuffixWindow(
          body,
          offset + quote.length,
          SNIPPET_CONTEXT_SIZE,
          'en',
        ),
    });
  }
  return candidates;
}

/**
 * Picks one occurrence of `quote` in the markdown `body` by plain string
 * matching only, so the same input always selects the same occurrence
 * (design.md「本文の markdown の一部を指定しての作成」).
 */
export function selectMarkdownOccurrence(
  body: string,
  quote: string,
  offset?: number,
): MarkdownOccurrenceSelection {
  if (offset != null && body.startsWith(quote, offset)) {
    return {
      kind: 'selected',
      range: { start: offset, end: offset + quote.length },
    };
  }

  const offsets = findOccurrenceOffsets(body, quote);
  if (offsets.length === 0) {
    return { kind: 'not-found' };
  }
  if (offset == null && offsets.length === 1) {
    return {
      kind: 'selected',
      range: { start: offsets[0], end: offsets[0] + quote.length },
    };
  }

  return {
    kind: offset == null ? 'ambiguous' : 'offset-mismatch',
    candidates: toCandidates(body, quote, offsets.slice(0, MAX_CANDIDATES)),
    total: offsets.length,
  };
}
