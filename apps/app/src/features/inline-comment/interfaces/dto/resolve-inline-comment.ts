/**
 * DTO types for PUT /_api/v3/inline-comments/:id/resolve (resolve toggle).
 *
 * Usable from both server and client — no server-side-only imports.
 */

import type { IInlineComment } from '../index';

/** Request body for PUT /_api/v3/inline-comments/:id/resolve. */
export interface ResolveInlineCommentRequestBody {
  resolved: boolean;
}

/** Response body for PUT /_api/v3/inline-comments/:id/resolve — design.md's `InlineComment`. */
export interface ResolveInlineCommentResponseBody {
  inlineComment: IInlineComment;
}
