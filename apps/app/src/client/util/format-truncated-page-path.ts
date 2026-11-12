import { DevidedPagePath } from '@growi/core/dist/models';
import { normalizePath } from '@growi/core/dist/utils/path-utils';

/**
 * A single rendered unit of a truncated page path.
 * - `segment`: an ancestor or the page name (bold when `isPageName`).
 * - `ellipsis`: the collapsed range of intermediate ancestors.
 */
export type PagePathPart =
  | {
      readonly type: 'segment';
      readonly text: string;
      readonly isPageName: boolean;
    }
  | { readonly type: 'ellipsis' };

export interface TruncatedPagePath {
  /** true when the path is the root ('/' or ''). */
  readonly isRoot: boolean;
  /** Ordered parts rendered with '/' separators. Empty when `isRoot`. */
  readonly parts: readonly PagePathPart[];
  /** Normalized full path, used for the hover tooltip. */
  readonly fullPath: string;
  /**
   * Ancestor portion of the path as split with trailing-date bundling
   * (`DevidedPagePath.former`), so callers can walk the ancestors without
   * re-parsing the same path.
   */
  readonly ancestorPath: string;
  /**
   * Highest collapse level this path accepts: the number of ancestors visible
   * in the base form (0-2).
   */
  readonly maxCollapseLevel: number;
}

const toSegment = (text: string, isPageName: boolean): PagePathPart => ({
  type: 'segment',
  text,
  isPageName,
});

const ELLIPSIS: PagePathPart = { type: 'ellipsis' };

// Below this unit count there is no intermediate ancestor to hide, so every unit is shown.
const MAX_UNITS_WITHOUT_TRUNCATION = 3;

/**
 * Ancestors visible in the base form (level 0). `hasEllipsis` tells whether an
 * ellipsis already sits between the first and the remaining visible ancestors.
 */
interface BaseAncestors {
  readonly visible: readonly string[];
  readonly hasEllipsis: boolean;
}

const toBaseAncestors = (ancestors: readonly string[]): BaseAncestors => {
  // Display units = ancestor segments + the page name.
  if (ancestors.length + 1 <= MAX_UNITS_WITHOUT_TRUNCATION) {
    return { visible: ancestors, hasEllipsis: false };
  }
  // >= 4 units: keep the first ancestor and the parent; the ones in between
  // collapse into a single ellipsis.
  return {
    visible: [ancestors[0], ancestors[ancestors.length - 1]],
    hasEllipsis: true,
  };
};

// Non-integer input (NaN, 0.5) must still land on a whole level; otherwise
// `slice(level)` would treat it as 0 and break the "tail of the chain" invariant.
const clampLevel = (level: number, max: number): number => {
  const whole = Number.isFinite(level) ? Math.trunc(level) : 0;
  return Math.min(Math.max(whole, 0), max);
};

const toAncestorParts = (
  base: BaseAncestors,
  level: number,
): PagePathPart[] => {
  const segments = base.visible.map((text) => toSegment(text, false));
  if (level === 0) {
    return base.hasEllipsis
      ? [segments[0], ELLIPSIS, ...segments.slice(1)]
      : segments;
  }
  // Folding always starts from the root side, so every folded ancestor sits
  // before the survivors and merges into one leading ellipsis.
  return [ELLIPSIS, ...segments.slice(level)];
};

/**
 * Convert a plain page path string into an ordered list of display parts with
 * Notion-style middle truncation, plus the normalized full path for tooltips.
 *
 * `collapseLevel` (default 0 = base form) folds the remaining visible ancestors
 * one by one from the root side, the parent last. It is clamped into
 * `0..maxCollapseLevel`.
 *
 * Page-name determination (including trailing-date bundling) follows the current
 * behavior by delegating to `DevidedPagePath` with `evalDatePath` enabled.
 *
 * Pure function: no React, no side effects, no DOM/network access.
 */
export const formatTruncatedPagePath = (
  path: string,
  collapseLevel = 0,
): TruncatedPagePath => {
  // `evalDatePath` (third arg) reproduces the current page-name rule (trailing date bundling).
  const devided = new DevidedPagePath(path, false, true);

  if (devided.isRoot) {
    return {
      isRoot: true,
      parts: [],
      fullPath: '/',
      ancestorPath: devided.former,
      maxCollapseLevel: 0,
    };
  }

  const ancestors = normalizePath(devided.former)
    .split('/')
    .filter((segment) => segment.length > 0);
  const base = toBaseAncestors(ancestors);
  const maxCollapseLevel = base.visible.length;
  const level = clampLevel(collapseLevel, maxCollapseLevel);

  return {
    isRoot: false,
    parts: [...toAncestorParts(base, level), toSegment(devided.latter, true)],
    fullPath: normalizePath(path),
    ancestorPath: devided.former,
    maxCollapseLevel,
  };
};
