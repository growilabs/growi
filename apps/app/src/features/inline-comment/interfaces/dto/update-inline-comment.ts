/**
 * DTO types for PUT /_api/v3/inline-comments/:id (origin comment body edit).
 *
 * Usable from both server and client — no server-side-only imports.
 */

import type { IInlineComment } from '../index';

/** Request body for PUT /_api/v3/inline-comments/:id. */
export interface UpdateInlineCommentRequestBody {
  comment: string;
}

/** Response body for PUT /_api/v3/inline-comments/:id. */
export interface UpdateInlineCommentResponseBody {
  inlineComment: IInlineComment;
}
