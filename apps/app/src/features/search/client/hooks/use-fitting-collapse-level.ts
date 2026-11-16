import { type RefObject, useCallback, useRef, useState } from 'react';
import { useIsomorphicLayoutEffect, useResizeObserver } from 'usehooks-ts';

export interface FittingCollapseLevel {
  /** Attach to the path's container (the single-line flex row) */
  readonly containerRef: RefObject<HTMLElement>;
  /** Attach to the element truncated per character (the page name in the modal); optional */
  readonly shrinkableRef: RefObject<HTMLElement>;
  readonly collapseLevel: number;
}

type ResizeAction = 'ignore' | 'recheckFromBase' | 'recheckFromCurrent';

// scrollWidth/clientWidth are rounded to integers, so content that exactly fits
// can read as 1px wider than its box; that must not count as overflowing.
const ROUNDING_TOLERANCE_PX = 1;

const isElementOverflowing = (element: HTMLElement | null): boolean =>
  element != null &&
  element.scrollWidth - element.clientWidth > ROUNDING_TOLERANCE_PX;

/**
 * Decides how a container width notification affects the collapse level,
 * compared with the width the current level was last fitted at.
 */
const resolveResizeAction = (
  fittedWidth: number | undefined,
  width: number,
): ResizeAction => {
  if (
    fittedWidth == null ||
    Math.abs(width - fittedWidth) <= ROUNDING_TOLERANCE_PX
  ) {
    return 'ignore';
  }
  return width > fittedWidth ? 'recheckFromBase' : 'recheckFromCurrent';
};

type FittingState = {
  readonly level: number;
  readonly resetKey: string;
  // Bumped to force a re-render (and thus a re-check) without changing level
  readonly checkRequest: number;
};

const initialState = (resetKey: string): FittingState => ({
  level: 0,
  resetKey,
  checkRequest: 0,
});

/**
 * Picks the smallest collapse level at which the rendered path fits in one line.
 *
 * - `resetKey` must change whenever the rendered content can change width
 *   (the path, its highlight markup) or `maxCollapseLevel` can change; the
 *   fitting then restarts from level 0.
 * - Assumes the container's width is given by its parent, not by its content;
 *   otherwise widening could not be detected and the path would stay collapsed.
 */
export const useFittingCollapseLevel = (
  maxCollapseLevel: number,
  resetKey: string,
): FittingCollapseLevel => {
  const containerRef = useRef<HTMLElement>(null);
  const shrinkableRef = useRef<HTMLElement>(null);
  // Width the current level was fitted at. Recorded at fitting time (not from
  // the observer's first notification), so a change in between is not lost.
  const fittedWidthRef = useRef<number | undefined>(undefined);

  const [state, setState] = useState<FittingState>(() =>
    initialState(resetKey),
  );

  // Reset during render (not in an effect) so a stale level is never committed
  if (state.resetKey !== resetKey) {
    setState(initialState(resetKey));
  }

  const collapseLevel = state.level;

  // Runs after every commit, before paint, so intermediate levels are never shown
  useIsomorphicLayoutEffect(() => {
    fittedWidthRef.current = containerRef.current?.clientWidth;
    if (collapseLevel >= maxCollapseLevel) return;
    if (
      isElementOverflowing(containerRef.current) ||
      isElementOverflowing(shrinkableRef.current)
    ) {
      setState((prev) => ({ ...prev, level: collapseLevel + 1 }));
    }
  });

  const onResize = useCallback(({ width }: { width?: number }) => {
    if (width == null) return;
    const action = resolveResizeAction(fittedWidthRef.current, width);
    if (action === 'ignore') return;
    fittedWidthRef.current = width;
    setState((prev) => ({
      ...prev,
      level: action === 'recheckFromBase' ? 0 : prev.level,
      checkRequest: prev.checkRequest + 1,
    }));
  }, []);

  useResizeObserver({ ref: containerRef, onResize });

  return { containerRef, shrinkableRef, collapseLevel };
};
