/**
 * DTO types for POST /_api/v3/inline-comments (origin-comment creation).
 *
 * Usable from both server and client — no server-side-only imports.
 * On the wire, ObjectIds are plain strings (JSON has no ObjectId type).
 */

import type { IInlineComment, InlineCommentAnchor } from '../index';

/** Request body for POST /_api/v3/inline-comments. */
export interface CreateInlineCommentRequestBody {
  pageId: string;
  anchorOriginRevisionId: string;
  comment: string;
  anchor: InlineCommentAnchor;
}

/** Response body for POST /_api/v3/inline-comments — design.md's `InlineComment`. */
export interface CreateInlineCommentResponseBody {
  inlineComment: IInlineComment;
}
