/**
 * Decide whether a container resize should trigger a full re-render of the
 * draw.io viewer.
 *
 * Re-rendering recreates the GraphViewer instance from scratch, which resets a
 * multi-page diagram back to its first page. The viewer's own page navigation
 * resizes the diagram *vertically* (the block's width stays fixed by the
 * surrounding layout), so reacting to those height-only changes would revert
 * the page the user just navigated to. Only a change in the available *width*
 * (window resize, editor pane resize, sidebar toggle, ...) requires a re-layout,
 * so gate the re-render on width alone.
 *
 * Widths are rounded before comparison to ignore sub-pixel jitter reported by
 * ResizeObserver.
 */
export const shouldRerenderOnResize = (
  prevWidth: number | undefined,
  nextWidth: number,
): boolean => {
  if (prevWidth == null) {
    return true;
  }
  return Math.round(prevWidth) !== Math.round(nextWidth);
};
