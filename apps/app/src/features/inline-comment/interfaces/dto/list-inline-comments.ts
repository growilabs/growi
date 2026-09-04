/**
 * DTO types for GET /_api/v3/inline-comments?pageId=... (page-scoped list).
 *
 * Usable from both server and client — no server-side-only imports.
 */

import type { InlineCommentWithReplies } from '../index';

/** Query parameters for GET /_api/v3/inline-comments. */
export interface ListInlineCommentsRequestQuery {
  pageId: string;
}

/**
 * Response body — design.md's `InlineComment[]` (creation-order, each element
 * carrying its nested `replies`). Wrapped in an object because `res.apiv3()`
 * requires a plain object body, not a bare array.
 */
export interface ListInlineCommentsResponseBody {
  inlineComments: InlineCommentWithReplies[];
}
