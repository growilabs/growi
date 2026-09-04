/**
 * Maps offsets between a string and its NFC-normalized form.
 *
 * NFC changes the number of UTF-16 code units in both directions, so an offset measured
 * in the normalized text cannot be reused as-is on the original text:
 *
 * - shrink: `"e" + U+0301` (2 code units) composes into `U+00E9` (1 code unit)
 * - grow:   `U+0958` (1 code unit) canonically decomposes into `U+0915 U+093C`
 *   (2 code units) and is not recomposed, because it is a composition exclusion
 *
 * Since the difference is not a constant, the two strings are walked in parallel from the
 * start and the code units each side consumes are recorded chunk by chunk.
 */

/** One chunk of the original text and the code units it occupies on each side. */
interface OffsetSegment {
  originalStart: number;
  originalEnd: number;
  normalizedStart: number;
  normalizedEnd: number;
  /** True when the chunk is byte-for-byte identical on both sides, so offsets inside it line up. */
  isUnchanged: boolean;
}

/**
 * Grapheme boundaries are locale-independent for this purpose (the segmentation rules that
 * matter here — combining marks and Hangul jamo staying with their base — do not vary by
 * locale), so the locale is deliberately left unspecified rather than plumbed through as a
 * parameter nobody has a value for.
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

/**
 * Splits `original` into chunks whose normalized form is exactly the next slice of
 * `normalized`. A grapheme cluster is the natural chunk: canonical composition never reaches
 * across a cluster boundary, so normalizing cluster by cluster gives the same result as
 * normalizing the whole string. Clusters are merged while they fail to line up, so a future
 * Unicode version that breaks that assumption degrades into larger chunks instead of a wrong
 * mapping.
 *
 * Returns `null` when the two strings cannot be walked in parallel at all — that is, when
 * `normalized` is not the NFC form of `original`.
 */
const buildSegments = (
  original: string,
  normalized: string,
): OffsetSegment[] | null => {
  const graphemes = Array.from(
    graphemeSegmenter.segment(original),
    (segment) => segment.segment,
  );

  const segments: OffsetSegment[] = [];
  let originalCursor = 0;
  let normalizedCursor = 0;
  let index = 0;

  while (index < graphemes.length) {
    let chunk = graphemes[index];
    index++;

    let chunkNormalized = chunk.normalize('NFC');
    while (
      !normalized.startsWith(chunkNormalized, normalizedCursor) &&
      index < graphemes.length
    ) {
      chunk += graphemes[index];
      index++;
      chunkNormalized = chunk.normalize('NFC');
    }
    if (!normalized.startsWith(chunkNormalized, normalizedCursor)) {
      return null;
    }

    segments.push({
      originalStart: originalCursor,
      originalEnd: originalCursor + chunk.length,
      normalizedStart: normalizedCursor,
      normalizedEnd: normalizedCursor + chunkNormalized.length,
      isUnchanged: chunk === chunkNormalized,
    });
    originalCursor += chunk.length;
    normalizedCursor += chunkNormalized.length;
  }

  return normalizedCursor === normalized.length ? segments : null;
};

const clamp = (value: number, max: number): number =>
  Math.min(Math.max(value, 0), max);

/**
 * An offset that falls strictly inside a chunk NFC rewrote is rounded down to the chunk's
 * start: the two forms of such a chunk have no aligned interior structure, so the start is the
 * only defensible answer. Callers that need an end offset to cover the whole chunk have to
 * extend it to `originalEnd` themselves.
 */
const toOriginal = (
  segments: OffsetSegment[] | null,
  originalLength: number,
  normalizedLength: number,
  normalizedOffset: number,
): number => {
  const offset = clamp(normalizedOffset, normalizedLength);

  if (segments == null) {
    return clamp(offset, originalLength);
  }

  const segment = segments.find(
    (candidate) => offset < candidate.normalizedEnd,
  );
  if (segment == null) {
    return originalLength;
  }

  return segment.isUnchanged
    ? segment.originalStart + (offset - segment.normalizedStart)
    : segment.originalStart;
};

const toNormalized = (
  segments: OffsetSegment[] | null,
  originalLength: number,
  normalizedLength: number,
  originalOffset: number,
): number => {
  const offset = clamp(originalOffset, originalLength);

  if (segments == null) {
    return clamp(offset, normalizedLength);
  }

  const segment = segments.find((candidate) => offset < candidate.originalEnd);
  if (segment == null) {
    return normalizedLength;
  }

  return segment.isUnchanged
    ? segment.normalizedStart + (offset - segment.originalStart)
    : segment.normalizedStart;
};

/**
 * Converts offsets between a text and its NFC form in both directions.
 *
 * Build one per text and reuse it: the parallel walk runs once, and matching a quote needs
 * both directions (design.md's quote-matcher contract converts `approxOffset` forward into
 * normalized coordinates in step 4, then converts the match position back in step 5).
 */
export interface NormalizedOffsetMapper {
  /** `original.normalize('NFC')`. Owned here so callers cannot pass a mismatched pair. */
  readonly normalizedText: string;
  /** An offset into `normalizedText` → the corresponding offset into the original text. */
  readonly toOriginalOffset: (normalizedOffset: number) => number;
  /** An offset into the original text → the corresponding offset into `normalizedText`. */
  readonly toNormalizedOffset: (originalOffset: number) => number;
}

export const createNormalizedOffsetMapper = (
  original: string,
): NormalizedOffsetMapper => {
  const normalizedText = original.normalize('NFC');
  const segments = buildSegments(original, normalizedText);

  return {
    normalizedText,
    toOriginalOffset: (normalizedOffset) =>
      toOriginal(
        segments,
        original.length,
        normalizedText.length,
        normalizedOffset,
      ),
    toNormalizedOffset: (originalOffset) =>
      toNormalized(
        segments,
        original.length,
        normalizedText.length,
        originalOffset,
      ),
  };
};

/**
 * One-off form of {@link NormalizedOffsetMapper.toOriginalOffset} for callers that already
 * hold both strings. `normalized` is expected to be `original.normalize('NFC')`; when it is
 * not, the offset is clamped into the original text rather than raising, because re-anchoring
 * is best effort and a viewer must never lose a comment to an exception.
 */
export const mapNormalizedOffsetToOriginal = (
  original: string,
  normalized: string,
  normalizedOffset: number,
): number => {
  // Checking the precondition up front (one linear normalize) keeps a mismatched pair out of
  // the parallel walk, whose merge step would otherwise re-normalize an ever-growing chunk
  // across the whole text before giving up.
  const segments =
    original.normalize('NFC') === normalized
      ? buildSegments(original, normalized)
      : null;

  return toOriginal(
    segments,
    original.length,
    normalized.length,
    normalizedOffset,
  );
};
