/**
 * Types shared between the client and server halves of the inline-comment
 * feature.
 *
 * `InlineCommentAnchor` intentionally mirrors the shape already declared
 * locally in `client/services/quote-matcher.ts`; keep the two in sync if
 * either changes.
 */

import type { IUserHasId } from '@growi/core';
import type { IUserSerializedSecurely } from '@growi/core/dist/models/serializers';

/**
 * The stored anchor of an inline comment: the exact quote as it was
 * selected, its surrounding context windows, and a rough offset of the
 * selection start. Never normalized.
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
  /**
   * Populated only by `listByPageId()`, run through `serializeUserSecurely`
   * (the same sanitization the ordinary comment list applies). `null` when
   * the user could not be resolved, or when produced by
   * `create()`/`setResolved()` (neither fetches the creator relation).
   */
  creator: IUserSerializedSecurely<IUserHasId> | null;
  comment: string;
  /** The revision the anchor was computed against. Set once at creation and never rewritten. */
  anchorOriginRevisionId: string;
  anchor: InlineCommentAnchor;
  resolvedById: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A reply to an origin inline comment (`isInline: true` with a non-null
 * `replyToId`). Holds no anchor and no resolved state — a plain comment
 * attached to its parent — so this type omits those fields entirely rather
 * than carrying them as `null`.
 */
export interface InlineCommentReply {
  id: string;
  pageId: string;
  creatorId: string;
  /** Populated only by `listByPageId()`, mirroring `IInlineComment.creator` above. */
  creator: IUserSerializedSecurely<IUserHasId> | null;
  comment: string;
  /** The origin inline comment this reply belongs to. */
  replyToId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** An origin inline comment together with its replies. */
export interface InlineCommentWithReplies extends IInlineComment {
  /** Replies to this origin comment, ordered the same way as the top-level list. */
  replies: InlineCommentReply[];
}

/**
 * Where an origin comment's anchor currently resolves to in the rendered
 * page text, as produced by `useAnchorResolver`. `startOffset`/`endOffset`
 * are UTF-16 code-unit offsets into the original (un-normalized) text
 * returned by `renderedTextOf` — the same coordinate space `matchQuote`'s
 * `QuoteMatchResult` reports in.
 */
export type ResolvedRange =
  | { status: 'exact' | 'fuzzy'; startOffset: number; endOffset: number }
  | { status: 'not_found' };
