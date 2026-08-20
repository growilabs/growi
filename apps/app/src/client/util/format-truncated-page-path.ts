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
 * Convert a plain page path string into an ordered list of display parts with
 * Notion-style middle truncation, plus the normalized full path for tooltips.
 *
 * Page-name determination (including trailing-date bundling) follows the current
 * behavior by delegating to `DevidedPagePath` with `evalDatePath` enabled.
 *
 * Pure function: no React, no side effects, no DOM/network access.
 */
export const formatTruncatedPagePath = (path: string): TruncatedPagePath => {
  // `evalDatePath` (third arg) reproduces the current page-name rule (trailing date bundling).
  const devided = new DevidedPagePath(path, false, true);

  if (devided.isRoot) {
    return { isRoot: true, parts: [], fullPath: '/' };
  }

  const pageName = devided.latter;
  const ancestors = normalizePath(devided.former)
    .split('/')
    .filter((segment) => segment.length > 0);

  // Display units = ancestor segments + the page name.
  const units = ancestors.length + 1;
  const fullPath = normalizePath(path);

  if (units <= MAX_UNITS_WITHOUT_TRUNCATION) {
    return {
      isRoot: false,
      parts: [
        ...ancestors.map((text) => toSegment(text, false)),
        toSegment(pageName, true),
      ],
      fullPath,
    };
  }

  // >= 4 units: keep the first ancestor, the parent (last ancestor) and the page
  // name; collapse every ancestor in between into a single ellipsis.
  return {
    isRoot: false,
    parts: [
      toSegment(ancestors[0], false),
      ELLIPSIS,
      toSegment(ancestors[ancestors.length - 1], false),
      toSegment(pageName, true),
    ],
    fullPath,
  };
};
