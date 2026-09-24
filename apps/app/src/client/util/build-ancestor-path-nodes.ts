import { DevidedPagePath } from '@growi/core/dist/models';

import {
  buildLinkedPagePathHref,
  LinkedPagePath,
} from '~/models/linked-page-path';

import { alignHighlightedPathSegments } from './align-highlighted-path-segments';
import { formatTruncatedPagePath } from './format-truncated-page-path';

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

/**
 * Flatten a `LinkedPagePath` chain (which links leaf -> root via `.parent`)
 * into a root-first array, stopping before the synthetic root sentinel node.
 */
const buildRootFirstChain = (topmost: LinkedPagePath): LinkedPagePath[] => {
  const leafToRoot: LinkedPagePath[] = [];

  let current: LinkedPagePath | undefined = topmost;
  while (current != null && !current.isRoot) {
    leafToRoot.push(current);
    current = current.parent;
  }

  return leafToRoot.reverse();
};

const toLinkNode = (
  plainNode: LinkedPagePath,
  highlightedHtml: string | undefined,
): AncestorPathNode => ({
  type: 'link',
  href: buildLinkedPagePathHref(plainNode),
  text: plainNode.pathName,
  // Markup identical to the plain text carries no highlight; render it as text.
  ...(highlightedHtml != null && highlightedHtml !== plainNode.pathName
    ? { highlightedHtml }
    : {}),
});

/**
 * Bridge `formatTruncatedPagePath`'s truncation decision with the plain
 * `LinkedPagePath` chain and the per-segment highlight markup, returning a
 * React-agnostic display plan for the ancestor-only portion of a page path
 * (the page name itself is dropped; callers render it separately).
 *
 * Surviving parts are mapped back to chain positions by counting from the head
 * for parts before the ellipsis and from the tail for parts after it, so this
 * works for any truncation shape with at most one ellipsis.
 *
 * Highlight markup is resolved per segment by `alignHighlightedPathSegments`;
 * a segment whose markup cannot be trusted is rendered as plain text.
 *
 * Pure function: no React, no DOM, no network. Never throws on a valid string input.
 */
export const buildAncestorPathNodes = (
  path: string,
  highlightedPath?: string | null,
): AncestorPathPlan => {
  const truncated = formatTruncatedPagePath(path);
  // Drop the trailing page-name part (always exactly one, always last).
  const ancestorParts = truncated.parts.slice(0, -1);

  if (ancestorParts.length === 0) {
    return { nodes: [], fullPath: truncated.fullPath };
  }

  const plainChain = buildRootFirstChain(
    new LinkedPagePath(new DevidedPagePath(path, false, true).former),
  );
  // Ancestors are the leading segments of the path, so chain index === segment index.
  const highlightedSegments = alignHighlightedPathSegments(
    path,
    highlightedPath,
  );

  const ellipsisIndex = ancestorParts.findIndex(
    (part) => part.type === 'ellipsis',
  );
  const toChainIndex = (partIndex: number): number =>
    ellipsisIndex === -1 || partIndex < ellipsisIndex
      ? partIndex
      : plainChain.length - (ancestorParts.length - partIndex);

  const nodes: AncestorPathNode[] = ancestorParts.map((part, partIndex) => {
    if (part.type === 'ellipsis') {
      return ELLIPSIS;
    }
    const chainIndex = toChainIndex(partIndex);
    return toLinkNode(plainChain[chainIndex], highlightedSegments[chainIndex]);
  });

  return { nodes, fullPath: truncated.fullPath };
};
