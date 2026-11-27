/**
 * Context windows around a quote, measured in UTF-16 code units and snapped
 * inward to grapheme cluster boundaries. Shared by the browser's selection
 * capture and the server's markdown-quote anchor builder so both store the
 * same shape of prefix/suffix.
 */

/** Default size (in UTF-16 code units) of the prefix/suffix context window; callers may pass another size. */
export const DEFAULT_TARGET_CONTEXT_WINDOW_SIZE = 40;

/**
 * Extra code units segmented beyond the target window size, so the boundary
 * we actually select is never close enough to the raw buffer slice's own
 * edge to be affected by a mid-cluster cut there. Generous enough to cover
 * long ZWJ emoji sequences (e.g. family/flag emoji, which can span well over
 * a dozen code units).
 */
const GRAPHEME_SAFETY_MARGIN = 32;

export function buildPrefixWindow(
  fullText: string,
  startOffset: number,
  targetWindowSize: number,
  locale: string,
): string {
  const bufferStart = Math.max(
    0,
    startOffset - (targetWindowSize + GRAPHEME_SAFETY_MARGIN),
  );
  const buffer = fullText.slice(bufferStart, startOffset);
  const boundaries = graphemeBoundaries(buffer, locale).map(
    (index) => index + bufferStart,
  );

  // Snap inward: the largest window that does not exceed targetWindowSize,
  // i.e. the smallest boundary at or after the ideal (possibly mid-cluster) start.
  const idealStart = Math.max(0, startOffset - targetWindowSize);
  const snappedStart = boundaries
    .filter((boundary) => boundary >= idealStart && boundary <= startOffset)
    .reduce((closest, boundary) => Math.min(closest, boundary), startOffset);

  return fullText.slice(snappedStart, startOffset);
}

export function buildSuffixWindow(
  fullText: string,
  endOffset: number,
  targetWindowSize: number,
  locale: string,
): string {
  const bufferEnd = Math.min(
    fullText.length,
    endOffset + targetWindowSize + GRAPHEME_SAFETY_MARGIN,
  );
  const buffer = fullText.slice(endOffset, bufferEnd);
  const boundaries = graphemeBoundaries(buffer, locale).map(
    (index) => index + endOffset,
  );

  // Snap inward: the largest window that does not exceed targetWindowSize,
  // i.e. the largest boundary at or before the ideal (possibly mid-cluster) end.
  const idealEnd = Math.min(fullText.length, endOffset + targetWindowSize);
  const snappedEnd = boundaries
    .filter((boundary) => boundary <= idealEnd && boundary >= endOffset)
    .reduce((farthest, boundary) => Math.max(farthest, boundary), endOffset);

  return fullText.slice(endOffset, snappedEnd);
}

/** Grapheme cluster boundary offsets within `text` (segment starts, plus the string's own end). */
const segmenters = new Map<string, Intl.Segmenter>();

function segmenterFor(locale: string): Intl.Segmenter {
  const cached = segmenters.get(locale);
  if (cached != null) return cached;
  const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
  segmenters.set(locale, segmenter);
  return segmenter;
}

function graphemeBoundaries(text: string, locale: string): number[] {
  const segmenter = segmenterFor(locale);
  const boundaries = Array.from(
    segmenter.segment(text),
    (segment) => segment.index,
  );
  boundaries.push(text.length);
  return boundaries;
}
