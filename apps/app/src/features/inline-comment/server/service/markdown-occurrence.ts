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
  /** The occurrence with a little of the markdown around it. */
  readonly snippet: string;
}

export type MarkdownOccurrenceSelection =
  | { readonly kind: 'selected'; readonly range: MarkdownRange }
  | { readonly kind: 'not-found' }
  | {
      readonly kind: 'ambiguous' | 'offset-mismatch';
      readonly candidates: readonly MarkdownOccurrenceCandidate[];
    };

const SNIPPET_CONTEXT_SIZE = 20;

function findOccurrenceOffsets(body: string, quote: string): number[] {
  const offsets: number[] = [];
  for (
    let found = body.indexOf(quote);
    found !== -1;
    found = body.indexOf(quote, found + 1)
  ) {
    offsets.push(found);
  }
  return offsets;
}

function lineNumberAt(body: string, offset: number): number {
  let line = 1;
  for (
    let newline = body.indexOf('\n');
    newline !== -1 && newline < offset;
    newline = body.indexOf('\n', newline + 1)
  ) {
    line++;
  }
  return line;
}

function toCandidate(
  body: string,
  quote: string,
  offset: number,
): MarkdownOccurrenceCandidate {
  const end = offset + quote.length;
  return {
    offset,
    line: lineNumberAt(body, offset),
    snippet:
      buildPrefixWindow(body, offset, SNIPPET_CONTEXT_SIZE, 'en') +
      quote +
      buildSuffixWindow(body, end, SNIPPET_CONTEXT_SIZE, 'en'),
  };
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
  const offsets = findOccurrenceOffsets(body, quote);
  if (offsets.length === 0) {
    return { kind: 'not-found' };
  }

  const selectedOffset =
    offset == null
      ? offsets.length === 1
        ? offsets[0]
        : undefined
      : offsets.find((candidate) => candidate === offset);
  if (selectedOffset != null) {
    return {
      kind: 'selected',
      range: { start: selectedOffset, end: selectedOffset + quote.length },
    };
  }

  return {
    kind: offset == null ? 'ambiguous' : 'offset-mismatch',
    candidates: offsets.map((candidate) => toCandidate(body, quote, candidate)),
  };
}
