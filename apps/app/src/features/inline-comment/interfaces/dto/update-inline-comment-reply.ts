/**
 * DTO types for PUT /_api/v3/inline-comments/replies/:id (reply body edit).
 *
 * Usable from both server and client — no server-side-only imports.
 */

import type { InlineCommentReply } from '../index';

/** Request body for PUT /_api/v3/inline-comments/replies/:id. */
export interface UpdateInlineCommentReplyRequestBody {
  comment: string;
}

/** Response body for PUT /_api/v3/inline-comments/replies/:id. */
export interface UpdateInlineCommentReplyResponseBody {
  inlineCommentReply: InlineCommentReply;
}
