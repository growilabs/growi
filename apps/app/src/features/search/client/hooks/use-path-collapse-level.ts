import type { ParsedPagePath } from '~/client/util/format-truncated-page-path';

import {
  type FittingCollapseLevel,
  useFittingCollapseLevel,
} from './use-fitting-collapse-level';

/**
 * Collapse level for one search-result page path, shared by the search modal
 * and the search results list so both fold the same path the same way.
 *
 * The highlight markup is part of the reset key because highlighted text is
 * rendered bold (wider): the same page re-rendered for a new keyword must be
 * fitted again from the base form.
 *
 * Takes the path already split by `parsePagePath`, which the caller reuses to
 * build the parts for the chosen level.
 */
export const usePathCollapseLevel = (
  { path, maxCollapseLevel }: ParsedPagePath,
  highlightedPath?: string | null,
): FittingCollapseLevel => {
  // NUL never appears in a page path, so the joined key is unambiguous
  return useFittingCollapseLevel(
    maxCollapseLevel,
    `${path}\u0000${highlightedPath ?? ''}`,
  );
};
