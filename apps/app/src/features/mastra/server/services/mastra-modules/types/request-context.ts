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
 * - `modelId` is the per-request model for the chat client's selection. The
 *   post-message handler resolves the client value through `resolveEffectiveModelId`
 *   (the single allow-list rounding checkpoint — an out-of-allowlist / omitted
 *   value is collapsed to the default) and sets the ALREADY-RESOLVED id here.
 *   `growiAgent`'s dynamic model function passes it to `resolveMastraModel`, whose
 *   own allow-list check is then an idempotent defense-in-depth re-validation
 *   rather than the first rounding pass. It stays optional only for the type's
 *   sake; the handler always sets a concrete resolved id when AI is configured.
 */
export type MastraRequestContextShape = {
  user: IUserHasId;
  searchService: SearchService;
  modelId?: string;
};
