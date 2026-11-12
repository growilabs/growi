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

const isElementOverflowing = (element: HTMLElement | null): boolean =>
  element != null && element.scrollWidth > element.clientWidth;

/**
 * Decides how a container width notification affects the collapse level.
 * The first notification after observing starts only reports the initial size,
 * so it is not a change (otherwise every row would re-fit right after mounting).
 */
const resolveResizeAction = (
  previousWidth: number | undefined,
  width: number,
): ResizeAction => {
  if (previousWidth == null || width === previousWidth) {
    return 'ignore';
  }
  return width > previousWidth ? 'recheckFromBase' : 'recheckFromCurrent';
};

type FittingState = {
  readonly level: number;
  readonly resetKey: string;
  readonly maxCollapseLevel: number;
  // Bumped to force a re-render (and thus a re-check) without changing level
  readonly checkRequest: number;
};

const initialState = (
  resetKey: string,
  maxCollapseLevel: number,
): FittingState => ({ level: 0, resetKey, maxCollapseLevel, checkRequest: 0 });

/**
 * Picks the smallest collapse level at which the rendered path fits in one line.
 * Assumes the container's width is given by its parent, not by its content;
 * otherwise widening could not be detected and the path would stay collapsed.
 */
export const useFittingCollapseLevel = (
  maxCollapseLevel: number,
  resetKey: string,
): FittingCollapseLevel => {
  const containerRef = useRef<HTMLElement>(null);
  const shrinkableRef = useRef<HTMLElement>(null);
  const lastWidthRef = useRef<number | undefined>(undefined);

  const [state, setState] = useState<FittingState>(() =>
    initialState(resetKey, maxCollapseLevel),
  );

  // Reset during render (not in an effect) so a stale level is never committed
  if (
    state.resetKey !== resetKey ||
    state.maxCollapseLevel !== maxCollapseLevel
  ) {
    setState(initialState(resetKey, maxCollapseLevel));
  }

  const collapseLevel = Math.min(state.level, maxCollapseLevel);

  // Runs after every commit, before paint, so intermediate levels are never shown
  useIsomorphicLayoutEffect(() => {
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
    const action = resolveResizeAction(lastWidthRef.current, width);
    lastWidthRef.current = width;
    if (action === 'ignore') return;
    setState((prev) => ({
      ...prev,
      level: action === 'recheckFromBase' ? 0 : prev.level,
      checkRequest: prev.checkRequest + 1,
    }));
  }, []);

  useResizeObserver({ ref: containerRef, onResize });

  return { containerRef, shrinkableRef, collapseLevel };
};
