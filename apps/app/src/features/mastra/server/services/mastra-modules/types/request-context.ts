import type { IUserHasId } from '@growi/core';

import type SearchService from '~/server/service/search';

/**
 * Shape of RequestContext keys shared between the post-message handler
 * (writer) and each Mastra tool's execute (reader).
 *
 * Updating this single file propagates a type mismatch to the handler and
 * to every tool when keys are added or renamed.
 *
 * Notes on `user`:
 * - `user` is `req.user` as exposed after the `loginRequiredStrictly`
 *   middleware (an `IUserHasId`). The tool layer MUST NOT extract only
 *   `_id` or re-resolve via `User.findById`.
 * - Downstream helpers such as `Page.findByIdAndViewer` and
 *   `SearchService.searchKeyword` accept the whole user object and read
 *   the fields they need internally.
 */
export type MastraRequestContextShape = {
  vectorStoreId: string;
  user: IUserHasId;
  searchService: SearchService;
};
