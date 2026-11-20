import { normalizePath } from '@growi/core/dist/utils/path-utils';

import { LinkedPagePath } from '~/models/linked-page-path';
import { buildLinkedPagePathHref } from '~/utils/build-linked-page-path-href';

import { alignHighlightedPathSegments } from './align-highlighted-path-segments';
import {
  formatTruncatedPagePath,
  type ParsedPagePath,
} from './format-truncated-page-path';

/**
 * A single rendered unit of the ancestor-path breadcrumb.
 * - `link`: a surviving ancestor segment. `highlightedHtml` is set only when
 *   that segment carries a reliably resolved search highlight.
 * - `ellipsis`: the collapsed range of intermediate ancestors. Never a link.
 */
export type AncestorPathNode =
  | {
      readonly type: 'link';
      readonly href: string;
      readonly text: string;
      readonly highlightedHtml?: string;
    }
  | { readonly type: 'ellipsis' };

export interface AncestorPathPlan {
  /** Empty when the page has no ancestors. */
  readonly nodes: readonly AncestorPathNode[];
  /** Full path including the page name, for the hover tooltip. */
  readonly fullPath: string;
}

const ELLIPSIS: AncestorPathNode = { type: 'ellipsis' };

interface AncestorSegment {
  /** The ancestor page itself, used to derive its href */
  readonly page: LinkedPagePath;
  readonly text: string;
}

/**
 * One entry per "/"-separated ancestor segment, root first. Each entry is built
 * from its own path prefix rather than by walking a single `LinkedPagePath`
 * chain: `LinkedPagePath` does not split on `</` (so `</em>` in highlight
 * markup stays intact), which would give a plain path like `/a</b` fewer chain
 * nodes than segments and break the index mapping below.
 */
const buildAncestorSegments = (
  ancestorPath: string,
): readonly AncestorSegment[] => {
  const segments = normalizePath(ancestorPath)
    .split('/')
    .filter((segment) => segment.length > 0);

  return segments.map((text, index) => ({
    page: new LinkedPagePath(`/${segments.slice(0, index + 1).join('/')}`),
    text,
  }));
};

const toLinkNode = (
  { page, text }: AncestorSegment,
  highlightedHtml: string | undefined,
): AncestorPathNode => ({
  type: 'link',
  href: buildLinkedPagePathHref(page),
  text,
  // Markup identical to the plain text carries no highlight; render it as text.
  ...(highlightedHtml != null && highlightedHtml !== text
    ? { highlightedHtml }
    : {}),
});

/**
 * Takes the path already split by `parsePagePath`, so the caller that also
 * needs its maximum collapse level parses it only once.
 *
 * Bridge `formatTruncatedPagePath`'s truncation decision with the plain
 * ancestor segments (links) and the per-segment highlight markup, returning a
 * React-agnostic display plan for the ancestor-only portion of a page path
 * (the page name itself is dropped; callers render it separately).
 *
 * Surviving parts are mapped back to ancestor positions by counting from the head
 * for parts before the ellipsis and from the tail for parts after it, so this
 * works for any truncation shape with at most one ellipsis.
 *
 * `collapseLevel` is passed straight to `formatTruncatedPagePath` (default 0 =
 * base form), so both search screens fold the same path the same way.
 *
 * Highlight markup is resolved per segment by `alignHighlightedPathSegments`;
 * a segment whose markup cannot be trusted is rendered as plain text.
 *
 * Pure function: no React, no DOM, no network. Never throws on a valid string input.
 */
export const buildAncestorPathNodes = (
  parsed: ParsedPagePath,
  highlightedPath?: string | null,
  collapseLevel = 0,
): AncestorPathPlan => {
  const { path } = parsed;
  const truncated = formatTruncatedPagePath(parsed, collapseLevel);
  const { fullPath } = truncated;
  // Drop the trailing page-name part (always exactly one, always last).
  const ancestorParts = truncated.parts.slice(0, -1);

  if (ancestorParts.length === 0) {
    return { nodes: [], fullPath };
  }

  const ancestors = buildAncestorSegments(truncated.ancestorPath);
  // Ancestors are the leading segments of the path, so ancestor index === segment index.
  const highlightedSegments = alignHighlightedPathSegments(
    path,
    highlightedPath,
  );

  const ellipsisIndex = ancestorParts.findIndex(
    (part) => part.type === 'ellipsis',
  );
  const toAncestorIndex = (partIndex: number): number =>
    ellipsisIndex === -1 || partIndex < ellipsisIndex
      ? partIndex
      : ancestors.length - (ancestorParts.length - partIndex);

  const nodes: AncestorPathNode[] = ancestorParts.map((part, partIndex) => {
    if (part.type === 'ellipsis') {
      return ELLIPSIS;
    }
    const ancestorIndex = toAncestorIndex(partIndex);
    return toLinkNode(
      ancestors[ancestorIndex],
      highlightedSegments[ancestorIndex],
    );
  });

  return { nodes, fullPath };
};
