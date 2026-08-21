import { DevidedPagePath } from '@growi/core/dist/models';

import {
  buildLinkedPagePathHref,
  LinkedPagePath,
} from '~/models/linked-page-path';
import loggerFactory from '~/utils/logger';

import { formatTruncatedPagePath } from './format-truncated-page-path';

const logger = loggerFactory('growi:client:build-ancestor-path-nodes');

/**
 * A single rendered unit of the ancestor-path breadcrumb.
 * - `link`: a surviving ancestor segment. `highlightedHtml` is set only when a
 *   corresponding highlighted node was resolved (see `buildAncestorPathNodes`).
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
  /** false => caller renders home/trash icon only, `nodes` is empty. */
  readonly hasAncestors: boolean;
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
  highlightedNode: LinkedPagePath | undefined,
  isHighlightReliable: boolean,
): AncestorPathNode => {
  const highlightedHtml =
    isHighlightReliable && highlightedNode != null
      ? highlightedNode.pathName
      : undefined;

  return {
    type: 'link',
    href: buildLinkedPagePathHref(plainNode),
    text: plainNode.pathName,
    ...(highlightedHtml != null ? { highlightedHtml } : {}),
  };
};

/**
 * Bridge `formatTruncatedPagePath`'s truncation decision with the plain and
 * highlighted `LinkedPagePath` chains, returning a React-agnostic display
 * plan for the ancestor-only portion of a page path (the page name itself is
 * dropped; callers render it separately).
 *
 * The truncated-ancestor-parts shape from `formatTruncatedPagePath` is always
 * either (a) every ancestor, in order, or (b) exactly [first, ellipsis, last].
 * This function relies on that fixed shape rather than a generic sliding
 * window or text-matching algorithm (see research.md).
 *
 * If the plain and highlighted chains resolve to a different total length,
 * partial index correspondence cannot be trusted (there is no reliable way to
 * know which index caused the drift), so the entire ancestor path falls back
 * to plain text with no `highlightedHtml` on any node.
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
    return { hasAncestors: false, nodes: [], fullPath: truncated.fullPath };
  }

  // `skipNormalize: true` for the highlighted variant mirrors the existing
  // dual-tree pattern in PageListItemL/PagePathHierarchicalLink: the
  // highlighted string embeds <em> markup that normalization must not touch.
  const plainFormer = new DevidedPagePath(path, false, true).former;
  const highlightedFormer = new DevidedPagePath(
    highlightedPath ?? path,
    true,
    true,
  ).former;

  const plainChain = buildRootFirstChain(new LinkedPagePath(plainFormer));
  const highlightedChain = buildRootFirstChain(
    new LinkedPagePath(highlightedFormer),
  );

  const isHighlightReliable = plainChain.length === highlightedChain.length;
  const isTruncated = ancestorParts.some((part) => part.type === 'ellipsis');

  // Defensive invariant: this function hardcodes formatTruncatedPagePath's two
  // known truncation shapes (all ancestors, or exactly [first, ellipsis, last])
  // rather than deriving kept positions generically (see the module doc
  // comment above). If that upstream shape ever changes, this won't throw or
  // fail type-checking on its own -- it would silently render the wrong
  // ancestors. Surface that loudly during development instead of staying silent.
  const hasExpectedShape = isTruncated
    ? ancestorParts.length === 3
    : ancestorParts.length === plainChain.length;
  if (!hasExpectedShape) {
    logger.error(
      'formatTruncatedPagePath returned an unexpected truncation shape ' +
        `(ancestorParts.length=${ancestorParts.length}, plainChain.length=${plainChain.length}, isTruncated=${isTruncated}). ` +
        "buildAncestorPathNodes assumes a fixed [first, ellipsis, last] or all-ancestors shape; update it if formatTruncatedPagePath's algorithm changed.",
    );
  }

  const nodes: AncestorPathNode[] = isTruncated
    ? [
        toLinkNode(plainChain[0], highlightedChain[0], isHighlightReliable),
        ELLIPSIS,
        toLinkNode(
          plainChain[plainChain.length - 1],
          highlightedChain[plainChain.length - 1],
          isHighlightReliable,
        ),
      ]
    : plainChain.map((node, index) =>
        toLinkNode(node, highlightedChain[index], isHighlightReliable),
      );

  return { hasAncestors: true, nodes, fullPath: truncated.fullPath };
};
