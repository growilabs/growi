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
 *
 * Notes on `modelId`:
 * - `modelId` is the per-request model selected by the chat client. It is
 *   set by the post-message handler and read by `growiAgent`'s dynamic model
 *   function to resolve the effective model. It is optional: when absent the
 *   resolver falls back to the configured default. The value is NOT trusted —
 *   `resolveMastraModel` validates it against the allow-list.
 */
export type MastraRequestContextShape = {
  user: IUserHasId;
  searchService: SearchService;
  modelId?: string;
};
