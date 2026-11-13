import urljoin from 'url-join';

import type { LinkedPagePath } from '~/models/linked-page-path';

/**
 * Build a navigable href for a `LinkedPagePath` node, joined onto an optional
 * base path and percent-encoded. Shared by `PagePathHierarchicalLink` and
 * `buildAncestorPathNodes` so the two ancestor-breadcrumb renderers stay in
 * sync on how a link target is derived from a `LinkedPagePath`.
 */
export const buildLinkedPagePathHref = (
  linkedPagePath: LinkedPagePath,
  basePath?: string,
): string => encodeURI(urljoin(basePath || '/', linkedPagePath.href));
