/**
 * Types shared between the client and server halves of the inline-comment
 * feature (design.md: File Structure Plan > interfaces/index.ts).
 *
 * `InlineCommentAnchor` intentionally mirrors the shape already declared
 * locally in `client/services/quote-matcher.ts` (that file predates this
 * barrel and keeps its own copy for now — see the comment there). Keep the
 * two in sync if either changes; unifying them is left to whichever task
 * next touches the client anchor-matching code.
 */

/**
 * The stored anchor of an inline comment: the exact quote as it was
 * selected, its surrounding context windows, and a rough offset of the
 * selection start. Never normalized (requirement 1.4).
 */
export interface InlineCommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  /**
   * A rough UTF-16 code-unit offset of the selection start in the text the
   * anchor was captured from. Read only to disambiguate several occurrences
   * of the same quote, never for anything else.
   */
  approxOffset: number;
}

/**
 * An origin (anchored) inline comment. Reply rows (`isInline: true` with a
 * non-null `replyToId`) are a separate type, `InlineCommentReply` below.
 */
export interface IInlineComment {
  id: string;
  pageId: string;
  creatorId: string;
  comment: string;
  /**
   * The revision the anchor was computed against. Set once at creation and
   * never rewritten afterward, regardless of re-anchoring outcome
   * (requirement 5.4, 5.5).
   */
  anchorOriginRevisionId: string;
  anchor: InlineCommentAnchor;
  resolvedById: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A reply to an origin inline comment (`isInline: true` with a non-null
 * `replyToId`). Design.md's aggregate model (`InlineCommentReply`, "子エン
 * ティティ") explicitly holds no anchor and no resolved state — it is a
 * plain comment attached to its parent — so this type omits those fields
 * entirely rather than carrying them as `null` (requirement 1.9).
 */
export interface InlineCommentReply {
  id: string;
  pageId: string;
  creatorId: string;
  comment: string;
  /** The origin inline comment this reply belongs to. */
  replyToId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An origin inline comment together with its replies, nested per
 * design.md's `listByPageId` Service Interface
 * (`listByPageId(pageId: string): Promise<InlineComment[]>; // 各要素が返信のネスト配列を含む`)
 * and Domain Model (`InlineComment` is the aggregate root holding a nested
 * `InlineCommentReply[]`).
 */
export interface InlineCommentWithReplies extends IInlineComment {
  /** Replies to this origin comment, ordered the same way as the top-level list. */
  replies: InlineCommentReply[];
}
