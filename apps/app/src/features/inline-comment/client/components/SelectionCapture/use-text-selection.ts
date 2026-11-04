import { type RefObject, useEffect, useState } from 'react';

import { renderedTextOf } from '../../services/rendered-text';

/**
 * The result of capturing a text selection: the exact (unnormalized) quote,
 * grapheme-safe surrounding context windows, and a rough code-unit offset
 * into the container's extracted text (see `renderedTextOf`).
 */
export interface CapturedSelection {
  /** The exact, unnormalized selected text; NFC normalization happens later, at match time, in quote-matcher. */
  quote: string;
  prefix: string;
  suffix: string;
  /**
   * A rough UTF-16 code-unit offset within the text `renderedTextOf` extracts
   * from the container — NOT the container's raw `textContent` (which also
   * counts excluded subtrees like `.katex`). Used only to disambiguate
   * multiple occurrences of the same quote when re-matching later.
   */
  approxOffset: number;
}

/** Default size (in UTF-16 code units) of the prefix/suffix context window; callers may override via `CaptureSelectionOptions`. */
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
 * `containerEl`. Returns null for a collapsed selection, an empty selected
 * string, or a selection outside the given container. Pure with respect to
 * the DOM: only reads, never mutates.
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
  // Counting here the same way anchor resolution counts later is what keeps
  // a stored approxOffset comparable at match time.
  const rendered = renderedTextOf(containerEl);
  const fullText = rendered.text;
  const startOffset = rendered.textOffsetOf(
    range.startContainer,
    range.startOffset,
  );
  const endOffset = rendered.textOffsetOf(range.endContainer, range.endOffset);

  return {
    quote,
    prefix: buildPrefixWindow(fullText, startOffset, targetWindowSize, locale),
    suffix: buildSuffixWindow(fullText, endOffset, targetWindowSize, locale),
    approxOffset: startOffset,
  };
}

/**
 * Pure hook: watches the document's selection state and returns the
 * currently captured selection scoped to `containerRef`, or null when there
 * is no non-empty selection inside it.
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
