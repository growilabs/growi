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

/**
 * A page path split once into what every collapse level is built from, so the
 * maximum level and the parts for each level come from a single parse.
 */
export interface ParsedPagePath {
  /** The path as given (not normalized), e.g. for aligning highlight markup. */
  readonly path: string;
  /** true when the path is the root ('/' or ''). */
  readonly isRoot: boolean;
  /** Normalized full path, used for the hover tooltip. */
  readonly fullPath: string;
  /**
   * Ancestor portion of the path as split with trailing-date bundling
   * (`DevidedPagePath.former`), so callers can walk the ancestors without
   * re-parsing the same path.
   */
  readonly ancestorPath: string;
  readonly pageName: string;
  /** Ancestors visible in the base form (level 0). */
  readonly visibleAncestors: readonly string[];
  /** Whether an ellipsis sits between the first and the remaining visible ancestors at level 0. */
  readonly hasMiddleEllipsis: boolean;
  /**
   * Highest collapse level this path accepts: the number of ancestors visible
   * in the base form (0-2).
   */
  readonly maxCollapseLevel: number;
}

export interface TruncatedPagePath {
  /** true when the path is the root ('/' or ''). */
  readonly isRoot: boolean;
  /** Ordered parts rendered with '/' separators. Empty when `isRoot`. */
  readonly parts: readonly PagePathPart[];
  /** Normalized full path, used for the hover tooltip. */
  readonly fullPath: string;
  /** Same as `ParsedPagePath.ancestorPath`. */
  readonly ancestorPath: string;
  /** Same as `ParsedPagePath.maxCollapseLevel`. */
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

// Display units = ancestor segments + the page name. With >= 4 units, only the
// first ancestor and the parent stay visible; the ones in between collapse into
// a single ellipsis.
const toVisibleAncestors = (
  ancestors: readonly string[],
): Pick<ParsedPagePath, 'visibleAncestors' | 'hasMiddleEllipsis'> => {
  if (ancestors.length + 1 <= MAX_UNITS_WITHOUT_TRUNCATION) {
    return { visibleAncestors: ancestors, hasMiddleEllipsis: false };
  }
  return {
    visibleAncestors: [ancestors[0], ancestors[ancestors.length - 1]],
    hasMiddleEllipsis: true,
  };
};

// Non-integer input (NaN, 0.5) must still land on a whole level; otherwise
// `slice(level)` would treat it as 0 and break the "tail of the chain" invariant.
const clampLevel = (level: number, max: number): number => {
  const whole = Number.isFinite(level) ? Math.trunc(level) : 0;
  return Math.min(Math.max(whole, 0), max);
};

const toAncestorParts = (
  parsed: ParsedPagePath,
  level: number,
): PagePathPart[] => {
  const segments = parsed.visibleAncestors.map((text) =>
    toSegment(text, false),
  );
  if (level === 0) {
    return parsed.hasMiddleEllipsis
      ? [segments[0], ELLIPSIS, ...segments.slice(1)]
      : segments;
  }
  // Folding always starts from the root side, so every folded ancestor sits
  // before the survivors and merges into one leading ellipsis.
  return [ELLIPSIS, ...segments.slice(level)];
};

/**
 * Split a plain page path into its ancestors and page name and decide how far
 * it can be collapsed. Notion-style middle truncation: with 4 or more display
 * units, only the first ancestor and the parent are visible in the base form.
 *
 * Page-name determination (including trailing-date bundling) follows the current
 * behavior by delegating to `DevidedPagePath` with `evalDatePath` enabled.
 *
 * Pure function: no React, no side effects, no DOM/network access.
 */
export const parsePagePath = (path: string): ParsedPagePath => {
  // `evalDatePath` (third arg) reproduces the current page-name rule (trailing date bundling).
  const devided = new DevidedPagePath(path, false, true);

  if (devided.isRoot) {
    return {
      path,
      isRoot: true,
      fullPath: '/',
      ancestorPath: devided.former,
      pageName: '',
      visibleAncestors: [],
      hasMiddleEllipsis: false,
      maxCollapseLevel: 0,
    };
  }

  const ancestors = normalizePath(devided.former)
    .split('/')
    .filter((segment) => segment.length > 0);
  const visible = toVisibleAncestors(ancestors);

  return {
    path,
    isRoot: false,
    fullPath: normalizePath(path),
    ancestorPath: devided.former,
    pageName: devided.latter,
    ...visible,
    maxCollapseLevel: visible.visibleAncestors.length,
  };
};

/**
 * Build the ordered display parts of a parsed page path for one collapse level,
 * plus the normalized full path for tooltips.
 *
 * `collapseLevel` (default 0 = base form) folds the remaining visible ancestors
 * one by one from the root side, the parent last. It is clamped into
 * `0..maxCollapseLevel`.
 *
 * Pure function: no React, no side effects, no DOM/network access.
 */
export const formatTruncatedPagePath = (
  parsed: ParsedPagePath,
  collapseLevel = 0,
): TruncatedPagePath => {
  const { isRoot, fullPath, ancestorPath, maxCollapseLevel } = parsed;
  if (isRoot) {
    return { isRoot, parts: [], fullPath, ancestorPath, maxCollapseLevel };
  }
  const level = clampLevel(collapseLevel, maxCollapseLevel);
  return {
    isRoot,
    parts: [
      ...toAncestorParts(parsed, level),
      toSegment(parsed.pageName, true),
    ],
    fullPath,
    ancestorPath,
    maxCollapseLevel,
  };
};
