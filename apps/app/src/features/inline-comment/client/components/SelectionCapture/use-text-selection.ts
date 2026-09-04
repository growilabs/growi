import { type RefObject, useEffect, useState } from 'react';

/**
 * The result of capturing a text selection: the exact (unnormalized) quote,
 * grapheme-safe surrounding context windows, and a rough code-unit offset
 * into the container's whole text.
 *
 * Shape mirrors `InlineCommentAnchor` (quote/prefix/suffix/approxOffset) as
 * described in design.md's Data Models section. It is declared locally here
 * (rather than imported from the shared interfaces module) because this
 * task's boundary is `use-text-selection` only, and the shared
 * `interfaces/index.ts` barrel does not exist yet in this worktree — it is
 * owned by a different, possibly-concurrent task.
 */
export interface CapturedSelection {
  /**
   * The exact, unnormalized selected text. NFC normalization is deliberately
   * NOT applied here — that only happens later, at match time, in
   * quote-matcher (Requirement 1.4).
   */
  quote: string;
  prefix: string;
  suffix: string;
  /**
   * A rough UTF-16 code-unit offset of the selection start within the
   * container's whole text. Used only to disambiguate multiple occurrences
   * of the same quote when re-matching later (see quote-matcher's algorithm
   * contract in design.md) — not read for any other purpose.
   */
  approxOffset: number;
}

/**
 * Default size (in UTF-16 code units) of the prefix/suffix context window.
 *
 * design.md pins the exact window-building technique (Intl.Segmenter +
 * inward grapheme-boundary snapping) but does not pin a specific size for
 * *this* hook (only for quote-matcher's consumption of prefix/suffix, which
 * reuses the same technique). 40 was chosen here as a reasonable amount of
 * surrounding context for later disambiguation without inflating the stored
 * anchor payload; callers may override it via `CaptureSelectionOptions`.
 */
export const DEFAULT_TARGET_CONTEXT_WINDOW_SIZE = 40;

/**
 * Extra code units segmented beyond the target window size, so the boundary
 * we actually select is never close enough to the raw buffer slice's own
 * edge to be affected by a mid-cluster cut there. Generous enough to cover
 * long ZWJ emoji sequences (e.g. family/flag emoji, which can span well over
 * a dozen code units).
 */
const GRAPHEME_SAFETY_MARGIN = 32;

export interface CaptureSelectionOptions {
  /** BCP 47 locale passed to Intl.Segmenter for grapheme boundary detection. */
  locale?: string;
  /** Target size (UTF-16 code units) for the prefix/suffix windows. */
  targetWindowSize?: number;
}

/**
 * Builds a CapturedSelection from a live DOM Selection, scoped to
 * `containerEl`. Returns null when there is nothing (usefully) selected —
 * a collapsed selection, an empty selected string (Requirement 1.7), or a
 * selection that falls outside the given container.
 *
 * Character-level (UTF-16 code unit) start/end handling throughout — no
 * rounding to line/paragraph boundaries (Requirement 1.3).
 *
 * Pure with respect to the DOM: only reads from `selection` and
 * `containerEl`, never mutates either.
 */
export function captureSelection(
  selection: Selection | null,
  containerEl: HTMLElement | null,
  options: CaptureSelectionOptions = {},
): CapturedSelection | null {
  if (selection == null || containerEl == null || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const quote = range.toString();
  if (quote === '') {
    // Covers both a collapsed selection and a genuinely empty selected string.
    return null;
  }

  if (!containerEl.contains(range.commonAncestorContainer)) {
    // The selection lives outside the monitored container (e.g. in a sidebar) — not an inline-comment target.
    return null;
  }

  const {
    locale = 'en',
    targetWindowSize = DEFAULT_TARGET_CONTEXT_WINDOW_SIZE,
  } = options;
  const fullText = containerEl.textContent ?? '';
  const startOffset = textOffsetOf(
    containerEl,
    range.startContainer,
    range.startOffset,
  );
  const endOffset = textOffsetOf(
    containerEl,
    range.endContainer,
    range.endOffset,
  );

  return {
    quote,
    prefix: buildPrefixWindow(fullText, startOffset, targetWindowSize, locale),
    suffix: buildSuffixWindow(fullText, endOffset, targetWindowSize, locale),
    approxOffset: startOffset,
  };
}

/**
 * Pure hook: watches the document's selection state and returns the
 * currently captured selection (quote/prefix/suffix/approxOffset) scoped to
 * `containerRef`, or null when there is no non-empty selection inside it
 * (Requirement 1.7).
 */
export function useTextSelection(
  containerRef: RefObject<HTMLElement | null>,
  options: CaptureSelectionOptions = {},
): CapturedSelection | null {
  const [captured, setCaptured] = useState<CapturedSelection | null>(null);
  const { locale, targetWindowSize } = options;

  useEffect(() => {
    const recapture = (): void => {
      const selection =
        typeof window === 'undefined' ? null : window.getSelection();
      setCaptured(
        captureSelection(selection, containerRef.current, {
          locale,
          targetWindowSize,
        }),
      );
    };

    // Judge once on mount too, in case a selection already exists when this hook attaches.
    recapture();

    document.addEventListener('selectionchange', recapture);
    return () => document.removeEventListener('selectionchange', recapture);
  }, [containerRef, locale, targetWindowSize]);

  return captured;
}

/**
 * The UTF-16 code-unit offset of (node, offset) within containerEl's text,
 * measured via Range.toString() rather than a manual TreeWalker — this
 * naturally handles both text-node and element-node range boundaries.
 */
function textOffsetOf(
  containerEl: HTMLElement,
  node: Node,
  offset: number,
): number {
  const measuringRange = document.createRange();
  measuringRange.setStart(containerEl, 0);
  measuringRange.setEnd(node, offset);
  return measuringRange.toString().length;
}

function buildPrefixWindow(
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

function buildSuffixWindow(
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
function graphemeBoundaries(text: string, locale: string): number[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
  const boundaries = Array.from(
    segmenter.segment(text),
    (segment) => segment.index,
  );
  boundaries.push(text.length);
  return boundaries;
}
