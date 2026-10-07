import type { IPageWithSearchMeta } from '~/interfaces/search';

import type { PagePathCandidate } from './types';

/**
 * Pure projection of a page search result into a display candidate.
 *
 * `data._id` is typed as a string by `HasObjectId`, so no ObjectId
 * stringification is required. Search meta is intentionally dropped.
 */
export const toPagePathCandidate = (
  result: IPageWithSearchMeta,
): PagePathCandidate => ({
  pageId: result.data._id,
  path: result.data.path,
  // Populated + serialized by the /search endpoint; rendered as the creator avatar.
  creator: result.data.creator ?? null,
});
