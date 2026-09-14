import type { RefObject } from 'react';
import { useEffect } from 'react';

import type { ResolvedRange } from '../../../interfaces';
import { rangesById } from '../../services/resolved-range';

/**
 * Name registered with `CSS.highlights` (the CSS Custom Highlight API) for
 * every currently-resolved inline-comment anchor. A single shared name is
 * enough here -- `exact`/`fuzzy` matches don't need to look different.
 */
const HIGHLIGHT_NAME = 'growi-inline-comment';

export interface InlineCommentHighlightProps {
  /** The same container `useAnchorResolver` reads the rendered text from. */
  containerRef: RefObject<HTMLElement | null>;
  /** The `Map` produced by `useAnchorResolver`, keyed by origin-comment id. */
  resolvedRanges: ReadonlyMap<string, ResolvedRange>;
}

// Checked once per module load (not per render) since support does not change at runtime.
const supportsCustomHighlightApi = (): boolean =>
  typeof CSS !== 'undefined' &&
  CSS.highlights != null &&
  typeof Highlight !== 'undefined';

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

    const ranges = Array.from(rangesById(container, resolvedRanges).values());

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
          background-color: var(--grw-inline-comment-marker-bg);
        }
      `}
    </style>
  );
};
