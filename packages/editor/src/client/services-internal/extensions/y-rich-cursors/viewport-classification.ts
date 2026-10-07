import type { EditorView } from '@codemirror/view';

export type CursorVisibility = 'above' | 'below' | 'in-viewport';

/**
 * Pre-computed viewport context, created once per update() call.
 *
 * Two classification strategies:
 * - "ranged": visibleRanges is a true sub-range of viewport
 *   (fixed-height editor, or tests with styled heights)
 * - "coords": visibleRanges == viewport, page handles scrolling
 *   (GROWI's page-scroll production setup).
 *   Also covers the degenerate case (scrollDOM height == 0 in jsdom)
 *   where screenVisibleTop == screenVisibleBottom, causing cursors
 *   with positive lineBlock.top to be classified as "below".
 */
export type ViewportContext =
  | { readonly kind: 'ranged'; readonly vpFrom: number; readonly vpTo: number }
  | {
      readonly kind: 'coords';
      readonly scrollDOMTop: number;
      readonly scrollTop: number;
      readonly screenVisibleTop: number;
      readonly screenVisibleBottom: number;
    };

/**
 * Determines the viewport classification mode from the current editor state.
 *
 * `getBoundingClientRect()` is a raw DOM call (not a CodeMirror layout read)
 * so it is safe to call during `update()`. `lineBlockAt()` (used later in
 * `classifyCursorPosition`) reads the stored height map and is also safe.
 */
export function createViewportContext(view: EditorView): ViewportContext {
  const { visibleRanges, viewport } = view;
  const { from: viewportFrom, to: viewportTo } = viewport;

  const hasVisibleRanges = visibleRanges.length > 0;

  // rangedMode: visibleRanges is a meaningful sub-range of viewport.
  // Requires the visible area to be non-empty (to > from) so that a 0-height
  // editor (jsdom degenerate) doesn't accidentally classify every cursor as
  // off-screen via a vpTo of 0.
  const rangedMode =
    hasVisibleRanges &&
    visibleRanges[visibleRanges.length - 1].to > visibleRanges[0].from &&
    (visibleRanges[0].from > viewportFrom ||
      visibleRanges[visibleRanges.length - 1].to < viewportTo);

  if (rangedMode) {
    return {
      kind: 'ranged',
      vpFrom: visibleRanges[0].from,
      vpTo: visibleRanges[visibleRanges.length - 1].to,
    };
  }

  // coords mode: compare screen Y of cursor against the editor's visible rect.
  // When scrollDOMRect.height == 0 (jsdom), screenVisibleTop == screenVisibleBottom,
  // so cursors with positive lineBlock.top are classified as "below" by the
  // natural comparison in classifyCursorPosition.
  const scrollDOMRect = view.scrollDOM.getBoundingClientRect();
  return {
    kind: 'coords',
    scrollDOMTop: scrollDOMRect.top,
    scrollTop: view.scrollDOM.scrollTop,
    screenVisibleTop: Math.max(scrollDOMRect.top, 0),
    screenVisibleBottom: Math.min(scrollDOMRect.bottom, window.innerHeight),
  };
}

/**
 * Classifies a remote cursor as above, below, or within the visible viewport.
 */
export function classifyCursorPosition(
  ctx: ViewportContext,
  view: EditorView,
  headIndex: number,
): CursorVisibility {
  switch (ctx.kind) {
    case 'ranged': {
      if (headIndex < ctx.vpFrom) return 'above';
      if (headIndex > ctx.vpTo) return 'below';
      return 'in-viewport';
    }
    case 'coords': {
      const lineBlock = view.lineBlockAt(headIndex);
      const cursorTop = ctx.scrollDOMTop + lineBlock.top - ctx.scrollTop;
      const cursorBottom = ctx.scrollDOMTop + lineBlock.bottom - ctx.scrollTop;
      if (cursorBottom < ctx.screenVisibleTop) return 'above';
      if (cursorTop > ctx.screenVisibleBottom) return 'below';
      return 'in-viewport';
    }
  }
}
