/**
 * DTO types for POST /_api/v3/inline-comments (origin-comment creation).
 *
 * Usable from both server and client — no server-side-only imports.
 * On the wire, ObjectIds are plain strings (JSON has no ObjectId type).
 */

import type { IInlineComment, InlineCommentAnchor } from '../index';

interface CreateInlineCommentRequestBodyBase {
  pageId: string;
  comment: string;
}

/** Creation with an anchor measured against the rendered page text (the browser's way). */
export interface CreateInlineCommentByAnchorRequestBody
  extends CreateInlineCommentRequestBodyBase {
  anchorOriginRevisionId: string;
  anchor: InlineCommentAnchor;
  markdownQuote?: never;
  markdownOffset?: never;
  revisionId?: never;
}

/**
 * Creation with a part of the page body markdown; the server computes the
 * anchor (requirement 26).
 */
export interface CreateInlineCommentByMarkdownQuoteRequestBody
  extends CreateInlineCommentRequestBodyBase {
  /** An exact substring of the latest revision's body markdown. */
  markdownQuote: string;
  /** UTF-16 index in the body where the chosen occurrence starts. */
  markdownOffset?: number;
  /** When given, must be the latest revision of the page. */
  revisionId?: string;
  anchor?: never;
  anchorOriginRevisionId?: never;
}

/** Request body for POST /_api/v3/inline-comments. */
export type CreateInlineCommentRequestBody =
  | CreateInlineCommentByAnchorRequestBody
  | CreateInlineCommentByMarkdownQuoteRequestBody;

/** Response body for POST /_api/v3/inline-comments. */
export interface CreateInlineCommentResponseBody {
  inlineComment: IInlineComment;
}
