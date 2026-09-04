/**
 * DTO types for POST /_api/v3/inline-comments/:id/replies (reply creation).
 *
 * Usable from both server and client — no server-side-only imports.
 */

import type { InlineCommentReply } from '../index';

/** Request body for POST /_api/v3/inline-comments/:id/replies. */
export interface CreateInlineCommentReplyRequestBody {
  comment: string;
}

/** Response body for POST /_api/v3/inline-comments/:id/replies — design.md's `InlineCommentReply`. */
export interface CreateInlineCommentReplyResponseBody {
  inlineCommentReply: InlineCommentReply;
}
