import type { RefObject } from 'react';
import { useEffect } from 'react';

/**
 * Name registered with `CSS.highlights` (the CSS Custom Highlight API) for the
 * range a comment is currently being composed for. Deliberately distinct from
 * the saved-comment highlight name so the two can be added and removed
 * independently, even while both are on screen.
 */
const PENDING_HIGHLIGHT_NAME = 'growi-inline-comment-pending';

/**
 * Marker attribute this component puts on the body container while it is
 * mounted. The container itself carries neither an id nor a class, so the
 * `::selection` rule below needs a hook of its own; owning that hook here
 * keeps `PageView` untouched and guarantees the override disappears together
 * with the component.
 */
const SCOPE_ATTR = 'data-inline-comment-selection-scope';

export interface PendingSelectionHighlightProps {
  /** The range being commented on. Nothing is painted while this is null. */
  range: Range | null;
  /** Limits the `::selection` override to the page body container. */
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * `CSS.highlights` support is checked once per module load (not per render)
 * since it does not change at runtime. Only the `::highlight()` half depends
 * on it — the `::selection` override works everywhere.
 */
const supportsCustomHighlightApi = (): boolean =>
  typeof CSS !== 'undefined' &&
  CSS.highlights != null &&
  typeof Highlight !== 'undefined';

/**
 * Paints the range a comment is being composed for, so the target text keeps
 * the marker color from the moment it is selected until the form closes.
 *
 * Two mechanisms are needed, and neither one alone is enough. While the text
 * is still selected, `::selection` paints above `::highlight()` in the CSS
 * highlight painting order, so the browser's default blue would win unless
 * `::selection` is overridden too. Once focus moves into the comment input the
 * document selection is dropped, so from then on only the `CSS.highlights`
 * registration keeps the range painted. Both read the same custom property, so
 * the color is decided in a single place.
 *
 * Renders no visible DOM itself: only a global `<style>` tag, the same shape
 * `InlineCommentHighlight` uses.
 */
export const PendingSelectionHighlight = ({
  range,
  containerRef,
}: PendingSelectionHighlightProps): React.ReactElement => {
  useEffect(() => {
    if (range == null || !supportsCustomHighlightApi()) {
      return;
    }

    CSS.highlights.set(PENDING_HIGHLIGHT_NAME, new Highlight(range));

    return () => {
      CSS.highlights.delete(PENDING_HIGHLIGHT_NAME);
    };
  }, [range]);

  useEffect(() => {
    const container = containerRef.current;
    if (range == null || container == null) {
      return;
    }

    container.setAttribute(SCOPE_ATTR, '');

    return () => {
      container.removeAttribute(SCOPE_ATTR);
    };
  }, [range, containerRef]);

  return (
    <style jsx global>
      {`
        /* Scoped to the marked body container, so selecting text anywhere
           else on the page keeps the browser's usual selection color. The
           text color has to be set alongside the background: leaving the
           browser's selection foreground (white in most environments) on top
           of the pale marker background makes the text unreadable. */
        [${SCOPE_ATTR}] ::selection {
          background-color: color-mix(in srgb, var(--grw-inline-comment-marker-bg-pending) 70%, transparent);
          color: var(--bs-body-color);
        }
        ::highlight(${PENDING_HIGHLIGHT_NAME}) {
          background-color: color-mix(in srgb, var(--grw-inline-comment-marker-bg-pending) 70%, transparent);
        }
      `}
    </style>
  );
};
