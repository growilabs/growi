import search from 'approx-string-match';

import { createNormalizedOffsetMapper } from './normalized-offset-mapping';

/**
 * The stored anchor of an inline comment: the exact quote as it was selected,
 * its surrounding context windows, and a rough offset of the selection start.
 *
 * Declared locally (rather than imported from a shared interfaces barrel)
 * because that barrel does not exist yet in this worktree and is owned by a
 * different, possibly-concurrent task — the same reasoning `use-text-selection`
 * records for `CapturedSelection`.
 */
export interface InlineCommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  /**
   * A rough UTF-16 code-unit offset of the selection start in the text the
   * anchor was captured from. Read only to disambiguate several occurrences of
   * the same quote, never for anything else.
   */
  approxOffset: number;
}

export interface QuoteMatchResult {
  status: 'exact' | 'fuzzy' | 'not_found';
  /** Offset into the original (un-normalized) text, in UTF-16 code units. */
  startOffset: number | null;
  endOffset: number | null;
}

/**
 * Fraction of the quote's length allowed as edit errors during fuzzy matching.
 * Exported as a named constant because design.md asks for it to be tunable.
 */
export const FUZZY_MATCH_ERROR_RATE = 0.2;

/**
 * Hard ceiling on the allowed edit errors, so a long quote does not get an
 * arbitrarily loose match.
 */
export const FUZZY_MATCH_MAX_ERRORS = 20;

const NOT_FOUND: QuoteMatchResult = {
  status: 'not_found',
  startOffset: null,
  endOffset: null,
};

/**
 * Grapheme boundaries do not vary by locale for the cases that matter here
 * (combining marks staying with their base), so the locale is left unspecified
 * rather than plumbed through as a parameter nobody has a value for — the same
 * choice `normalized-offset-mapping` makes.
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

/**
 * Locates an anchor's quote in `text`: exact matches first, then a fuzzy match
 * over the NFC-normalized forms, and finally `not_found`.
 *
 * `text` is the rendered page text as it is right now, which may have been
 * edited since the anchor was captured — hence the tolerance. Re-anchoring is
 * best effort: a quote that cannot be located simply loses its highlight.
 */
export function matchQuote(
  text: string,
  anchor: InlineCommentAnchor,
): QuoteMatchResult {
  const { quote } = anchor;
  if (quote === '') {
    // An empty quote would make indexOf report a bogus match at offset 0.
    return NOT_FOUND;
  }

  const exact = matchExactly(text, quote, anchor.approxOffset);
  if (exact != null) {
    return exact;
  }

  return matchApproximately(text, anchor);
}

/**
 * Enumerates every exact occurrence and keeps the one starting closest to
 * `approxOffset`. Runs on the un-normalized text, so its offsets need no
 * conversion.
 */
const matchExactly = (
  text: string,
  quote: string,
  approxOffset: number,
): QuoteMatchResult | null => {
  const starts: number[] = [];
  for (
    let index = text.indexOf(quote);
    index !== -1;
    index = text.indexOf(quote, index + 1)
  ) {
    starts.push(index);
  }

  const start = closestTo(approxOffset, starts);
  return start == null
    ? null
    : { status: 'exact', startOffset: start, endOffset: start + quote.length };
};

/**
 * Runs the approximate search over the NFC-normalized forms and converts the
 * winning match back into the original text's coordinates.
 *
 * `anchor.prefix` / `anchor.suffix` are deliberately unused: design.md's
 * algorithm searches for the quote alone and breaks ties on `approxOffset`
 * alone, so feeding the context windows into the search (or into a similarity
 * score) would be behavior the contract does not describe.
 */
const matchApproximately = (
  text: string,
  anchor: InlineCommentAnchor,
): QuoteMatchResult => {
  const mapper = createNormalizedOffsetMapper(text);
  const normalizedQuote = anchor.quote.normalize('NFC');

  // The un-normalized length is what the contract's formula names, and it is
  // the length a human would recognize as "the quote's length".
  const maxErrors = Math.min(
    Math.ceil(anchor.quote.length * FUZZY_MATCH_ERROR_RATE),
    FUZZY_MATCH_MAX_ERRORS,
  );

  const matches = search(mapper.normalizedText, normalizedQuote, maxErrors);
  const normalizedApproxOffset = mapper.toNormalizedOffset(anchor.approxOffset);
  const match = matches.reduce<(typeof matches)[number] | null>(
    (closest, candidate) =>
      closest == null ||
      Math.abs(candidate.start - normalizedApproxOffset) <
        Math.abs(closest.start - normalizedApproxOffset)
        ? candidate
        : closest,
    null,
  );
  if (match == null) {
    return NOT_FOUND;
  }

  // An end offset landing inside a character NFC rewrote would be rounded down
  // to that character's start on the way back, silently dropping it from the
  // match. Widening to the grapheme boundary first keeps the character: NFC
  // never rewrites across a cluster boundary, so a cluster boundary in the
  // normalized text is always a boundary the mapping can convert exactly.
  const normalizedEnd = snapToGraphemeEnd(mapper.normalizedText, match.end);

  return {
    status: 'fuzzy',
    startOffset: mapper.toOriginalOffset(match.start),
    endOffset: mapper.toOriginalOffset(normalizedEnd),
  };
};

/** The value in `candidates` nearest `target`, or null when there are none. */
const closestTo = (target: number, candidates: number[]): number | null =>
  candidates.reduce<number | null>(
    (closest, candidate) =>
      closest == null ||
      Math.abs(candidate - target) < Math.abs(closest - target)
        ? candidate
        : closest,
    null,
  );

/** `offset`, moved forward to the end of the grapheme cluster it splits. */
const snapToGraphemeEnd = (text: string, offset: number): number => {
  const segment = graphemeSegmenter.segment(text).containing(offset);
  return segment == null || segment.index === offset
    ? offset
    : segment.index + segment.segment.length;
};
