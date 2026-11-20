import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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
 * - Assumes the container's width does not depend on its content; otherwise
 *   widening could not be detected and the path would stay collapsed. The
 *   shared row recipe (`_truncated-path-row.scss`) provides this as long as the
 *   container is placed directly in a flex row or a block.
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
    const width = containerRef.current?.clientWidth;
    // This check only tells whether the current level overflows, not whether a
    // lower one would fit. If the container widened since the level was fitted
    // (e.g. between a narrowing notification and its commit), recording the new
    // width without re-fitting would hide the widening from later notifications.
    if (
      collapseLevel > 0 &&
      width != null &&
      resolveResizeAction(fittedWidthRef.current, width) === 'recheckFromBase'
    ) {
      fittedWidthRef.current = width;
      setState((prev) => ({ ...prev, level: 0 }));
      return;
    }
    fittedWidthRef.current = width;
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

  // A web font that finishes loading after fitting changes the text width but
  // not the container width, so no resize notification arrives. Re-fit from the
  // base form so it works whether the new font is wider or narrower.
  useEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (fonts == null) return;
    const refitFromBase = (): void => {
      setState((prev) => ({
        ...prev,
        level: 0,
        checkRequest: prev.checkRequest + 1,
      }));
    };
    fonts.addEventListener('loadingdone', refitFromBase);
    return () => fonts.removeEventListener('loadingdone', refitFromBase);
  }, []);

  return { containerRef, shrinkableRef, collapseLevel };
};
