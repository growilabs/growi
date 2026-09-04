import type { RefObject } from 'react';
import { useEffect } from 'react';

import type { ResolvedRange } from '../../../interfaces';
import { renderedTextOf } from '../../services/rendered-text';

/**
 * Name registered with `CSS.highlights` (the CSS Custom Highlight API) for
 * every currently-resolved inline-comment anchor. A single shared name is
 * enough for this task's boundary (design.md doesn't ask for `exact`/`fuzzy`
 * to look different) — see the `::highlight()` rule this component renders.
 */
const HIGHLIGHT_NAME = 'growi-inline-comment';

export interface InlineCommentHighlightProps {
  /** The same container `useAnchorResolver` reads the rendered text from. */
  containerRef: RefObject<HTMLElement | null>;
  /** The `Map` produced by `useAnchorResolver`, keyed by origin-comment id. */
  resolvedRanges: ReadonlyMap<string, ResolvedRange>;
}

/**
 * `CSS.highlights` support is checked once per module load (not per render)
 * since it does not change at runtime; browsers without it (design.md's
 * fallback for "見つからなければハイライトなし" applies the same way here:
 * no highlight, comment stays in the list) simply render nothing.
 */
const supportsCustomHighlightApi = (): boolean =>
  typeof CSS !== 'undefined' &&
  CSS.highlights != null &&
  typeof Highlight !== 'undefined';

const rangeFor = (
  renderedText: ReturnType<typeof renderedTextOf>,
  resolved: ResolvedRange,
): Range | null => {
  if (resolved.status === 'not_found') {
    return null;
  }

  const start = renderedText.resolveDomPosition(resolved.startOffset);
  const end = renderedText.resolveDomPosition(resolved.endOffset);
  if (start == null || end == null) {
    return null;
  }

  const range = new Range();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
};

/**
 * Draws a highlight for every resolved (non-`not_found`) range, using the
 * CSS Custom Highlight API (`CSS.highlights` + `::highlight()`).
 *
 * This technique was chosen over mutating the DOM (e.g. wrapping matched
 * text in `<mark>`) because `containerRef` points at a subtree React (via
 * `ReactMarkdown`) exclusively owns — injecting extra elements into it would
 * fight React's reconciliation on the next render. Registering `Range`
 * objects with `CSS.highlights` paints the highlight without adding, moving,
 * or splitting a single DOM node.
 *
 * Renders no visible DOM itself: only a global `<style>` tag defining the
 * `::highlight()` rule (this codebase's existing pattern for global-scope
 * CSS a component needs — see `components/FontFamily/use-lato.tsx`).
 */
export const InlineCommentHighlight = ({
  containerRef,
  resolvedRanges,
}: InlineCommentHighlightProps): React.ReactElement => {
  useEffect(() => {
    const container = containerRef.current;
    if (container == null || !supportsCustomHighlightApi()) {
      return;
    }

    const renderedText = renderedTextOf(container);
    const ranges: Range[] = [];
    for (const resolved of resolvedRanges.values()) {
      const range = rangeFor(renderedText, resolved);
      if (range != null) {
        ranges.push(range);
      }
    }

    if (ranges.length === 0) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      return;
    }

    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));

    return () => {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    };
  }, [containerRef, resolvedRanges]);

  return (
    <style jsx global>
      {`
        ::highlight(${HIGHLIGHT_NAME}) {
          background-color: var(--bs-warning-bg-subtle, rgba(255, 193, 7, 0.35));
        }
      `}
    </style>
  );
};
