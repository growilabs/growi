import type { VirtualElement } from '@popperjs/core';

/** Which end of a Range the user's cursor is at: `start` for a right-to-left drag, `end` for left-to-right. */
export type SelectionEdge = 'start' | 'end';

/**
 * Converts a DOM Range into a Popper "virtual element" (an object that only
 * implements getBoundingClientRect()), per the official pattern at
 * https://popper.js.org/docs/v2/virtual-elements/.
 *
 * `range.getBoundingClientRect()` is delegated to on every call rather than
 * being read once here, so a Range obtained via Range.cloneRange() keeps
 * tracking the live document position (e.g. after scrolling) — a cloned
 * Range stays attached to the document and its rect reflects current layout
 * on each call.
 */
export function rangeToVirtualElement(range: Range): VirtualElement {
  return {
    getBoundingClientRect: () => range.getBoundingClientRect(),
  };
}

const isZeroRect = (rect: DOMRect): boolean =>
  rect.width === 0 && rect.height === 0;

/**
 * The x coordinate of the range's `edge`. The collapsed caret rect is the
 * accurate answer, but it is rejected when it lies outside the range's
 * vertical extent (a selection ending at offset 0 of the next block puts the
 * caret on a line below the selected text); the outermost line box is used then.
 */
const edgeX = (range: Range, bounds: DOMRect, edge: SelectionEdge): number => {
  const caret = range.cloneRange();
  caret.collapse(edge === 'start');
  const caretRect = caret.getClientRects()[0];
  if (
    caretRect != null &&
    caretRect.top >= bounds.top &&
    caretRect.bottom <= bounds.bottom
  ) {
    return caretRect.left;
  }

  const lineRects = range.getClientRects();
  if (lineRects.length === 0) {
    return edge === 'start' ? bounds.left : bounds.right;
  }
  return edge === 'start'
    ? lineRects[0].left
    : lineRects[lineRects.length - 1].right;
};

/**
 * A Popper virtual element that is a zero-width rect at the x coordinate of
 * the range's `edge` and spans the range's full height, so a `top` placement
 * puts the popper above the selection, horizontally centred on the cursor.
 *
 * A degenerate range rect is returned as-is so callers can still detect a
 * range that no longer has layout.
 */
export function rangeToEdgeVirtualElement(
  range: Range,
  edge: SelectionEdge,
): VirtualElement {
  return {
    getBoundingClientRect: () => {
      const bounds = range.getBoundingClientRect();
      if (isZeroRect(bounds)) {
        return bounds;
      }

      const x = edgeX(range, bounds, edge);
      return {
        x,
        y: bounds.top,
        left: x,
        right: x,
        width: 0,
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  };
}
