import type { IUserHasId } from '@growi/core';

import type { UsageMeter } from '~/features/ai-usage/server';
import type SearchService from '~/server/service/search';

/**
 * Shape of RequestContext keys shared between the code that starts an agent
 * run (writer: the chat post-message handler, the suggest-path agentic engine)
 * and the agents' model functions and tools (readers).
 *
 * Updating this single file propagates a type mismatch to the writers and
 * to every reader when keys are added or renamed.
 *
 * Notes on `user`:
 * - `user` is `req.user` as exposed after the `loginRequiredStrictly`
 *   middleware (an `IUserHasId`). The tool layer MUST NOT extract only
 *   `_id` or re-resolve via `User.findById`.
 * - Downstream helpers such as `Page.findByIdAndViewer` and
 *   `SearchService.searchKeyword` accept the whole user object and read
 *   the fields they need internally.
 *
 * Notes on `modelKey`:
 * - `modelKey` is the per-request model as the composite `${provider}/${modelId}`
 *   key. The writer sets an ALREADY-RESOLVED key: the chat handler rounds the
 *   client's selection through `resolveEffectiveModelKey` (the single allow-list
 *   checkpoint — an out-of-allowlist / omitted key is collapsed to the effective
 *   default), and the suggest-path engine uses `getEffectiveDefaultModelKey`. The
 *   agent's dynamic model function passes it to `resolveMastraModel`, whose own
 *   allow-list check is then an idempotent defense-in-depth re-validation. The
 *   same key is the one usage is recorded under. It stays optional only for the
 *   type's sake; both writers always set a concrete resolved key.
 *
 * Notes on `usageMeter`:
 * - The request-scoped usage collector that the writer creates and closes
 *   around one response (one chat response, one suggest-path proposal). When
 *   it is absent, `meterModelForRequest` records each model call on its own
 *   instead.
 */
export type MastraRequestContextShape = {
  user: IUserHasId;
  searchService: SearchService;
  modelKey?: string;
  usageMeter?: UsageMeter;
};
