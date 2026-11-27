import { type RefObject, useEffect, useState } from 'react';

import {
  buildPrefixWindow,
  buildSuffixWindow,
  DEFAULT_TARGET_CONTEXT_WINDOW_SIZE,
} from '../../../utils/context-window';
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
