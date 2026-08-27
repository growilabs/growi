/**
 * InlineCommentService — persistence, Activity recording, and mention-notification
 * kickoff for inline comments (design.md: "InlineCommentService").
 *
 * This is the sole write path for `comments` rows with `isInline: true`
 * (design.md: Responsibilities & Constraints). `create()`, `createReply()`,
 * and `listByPageId()` are implemented here; `setResolved` (design.md's
 * Service Interface) is added by a later task (3.4) as a sibling method on
 * this same class — this file is structured so that addition doesn't need
 * to touch the existing methods.
 */

import type { IPageHasId } from '@growi/core';
import { Types } from 'mongoose';

import type { Prisma } from '~/generated/prisma/client';
import {
  SupportedAction,
  SupportedEventModel,
  SupportedTargetModel,
} from '~/interfaces/activity';
import type CommentService from '~/server/service/comment';
import loggerFactory from '~/utils/logger';
import type { PrismaClient } from '~/utils/prisma';

import type {
  IInlineComment,
  InlineCommentAnchor,
  InlineCommentReply,
  InlineCommentWithReplies,
} from '../../interfaces';

const logger = loggerFactory('growi:features:inline-comment:service');

// ---------------------------------------------------------------------------
// Service Interface (design.md)
// ---------------------------------------------------------------------------

export interface CreateInlineCommentInput {
  pageId: string;
  anchorOriginRevisionId: string;
  comment: string;
  anchor: InlineCommentAnchor;
}

export interface CreateInlineCommentReplyInput {
  /** The origin (anchored) inline comment this reply is attached to. */
  parentId: string;
  comment: string;
}

// ---------------------------------------------------------------------------
// Dependencies
//
// Per apps/app/.claude/rules/esm-authoring.md ("Services must not import the
// Crowi class"), this service takes its dependencies as a constructor
// argument rather than importing `Crowi` or the shared `prisma` singleton
// directly. `commentService` is typed against the real `CommentService`
// class (type-only import, erased at build — no runtime cycle), so the
// route layer (task 3.5) can pass `crowi.commentService` in unmodified.
//
// `prisma` is typed against the real generated `PrismaClient` (type-only
// import), narrowed with `Pick` to only the two delegates this service uses
// (`comments`, `activities`) rather than hand-written parallel interfaces.
// Row/result shapes below are derived from that same real client type via
// `Prisma.Result<...>` instead of being declared by hand, so they can never
// drift out of structural assignability with what real Prisma returns (see
// `.../audit-log-bulk-export/.../activity-export-cursor.ts` for the same
// pattern applied to `activities`).
// ---------------------------------------------------------------------------

/**
 * The `comments` row shape read back from `create()`'s insert, including the
 * `page` relation (`include: { page: true }`) so the row needed by
 * `prepareMentionNotifications` comes back in the same round trip instead of
 * a second dependency for fetching the page.
 */
type InlineCommentCreateResult = Prisma.Result<
  PrismaClient['comments'],
  { include: { page: true } },
  'create'
>;

/**
 * The `comments` row shape a `createReply()` insert reads back. No `page`
 * relation is pulled in here: `toPageHasId`/`prepareMentionNotifications`
 * need the *parent's* page, which the `findUnique()` parent lookup already
 * returns via its own `include: { page: true }`, so re-fetching it on the
 * reply row would be a redundant round trip.
 */
type InlineCommentReplyCreateResult = Prisma.Result<
  PrismaClient['comments'],
  object,
  'create'
>;

// The `findUnique()` lookup used to validate a `createReply()` `parentId`
// (isInline: true and replyToId: null — i.e. it is itself an origin
// comment) needs no separately-declared row type: its shape is inferred
// directly from `this.deps.prisma.comments.findUnique(...)`'s call-site
// return type, which is already derived from the real `PrismaClient`.

/**
 * The `comments` row shape `listByPageId()`'s two `findMany()` queries (no
 * `include`) read back — one row shape shared by both the origin-comment
 * query and the replies query. Derived the same way
 * `activity-export-cursor.ts` derives `activities.findMany()`'s row type
 * (`Awaited<ReturnType<...>>[number]`), an equally-proven alternative to
 * `Prisma.Result<...>` for this codebase (see
 * `.kiro/specs/inline-comment/tasks.md`'s Implementation Notes).
 */
type InlineCommentListRow = Awaited<
  ReturnType<PrismaClient['comments']['findMany']>
>[number];

export interface InlineCommentServiceDeps {
  prisma: Pick<PrismaClient, 'comments' | 'activities'>;
  commentService: Pick<CommentService, 'prepareMentionNotifications'>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adapts a Prisma `pages` row (as returned via `comments.create`'s /
 * `comments.findUnique`'s `include: { page: true }`) to the Mongoose-era
 * `IPageHasId` shape that `CommentService.prepareMentionNotifications` still
 * expects. GROWI's `$allModels` Prisma extension (`~/utils/prisma`) attaches
 * a computed `_id` alias for exactly this kind of legacy-shape compatibility
 * at runtime, but the *type* derived here via `Prisma.Result<...>` for a
 * nested `include`d relation does not reflect that extension's computed
 * field (the extension is applied to the top-level delegate, not to types
 * TypeScript can see through a relation include), so the alias is added
 * explicitly instead of relied upon implicitly.
 */
function toPageHasId(
  page: { id: string } & Record<string, unknown>,
): IPageHasId {
  return { ...page, _id: page.id } as unknown as IPageHasId;
}

function toIInlineComment(row: InlineCommentCreateResult): IInlineComment {
  // create() always writes these fields together (isInline: true rows), so a
  // row it just read back from its own insert is guaranteed to have them.
  if (
    row.creatorId == null ||
    row.quote == null ||
    row.prefix == null ||
    row.suffix == null ||
    row.approxOffset == null ||
    row.anchorOriginRevisionId == null
  ) {
    throw new Error(
      `Inline comment row '${row.id}' is missing required anchor fields`,
    );
  }

  return {
    id: row.id,
    pageId: row.pageId,
    creatorId: row.creatorId,
    comment: row.comment,
    anchorOriginRevisionId: row.anchorOriginRevisionId,
    anchor: {
      quote: row.quote,
      prefix: row.prefix,
      suffix: row.suffix,
      approxOffset: row.approxOffset,
    },
    resolvedById: row.resolvedById,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toInlineCommentReply(
  row: InlineCommentReplyCreateResult,
): InlineCommentReply {
  // createReply() always writes creatorId/replyToId together, so a row it
  // just read back from its own insert is guaranteed to have them.
  if (row.creatorId == null || row.replyToId == null) {
    throw new Error(
      `Inline comment reply row '${row.id}' is missing required fields`,
    );
  }

  return {
    id: row.id,
    pageId: row.pageId,
    creatorId: row.creatorId,
    comment: row.comment,
    replyToId: row.replyToId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Maps a `listByPageId()` origin-comment row (`InlineCommentListRow`) to the
 * anchor-bearing `IInlineComment` fields — the same fields `toIInlineComment`
 * produces, but for a row that never carried a `page` relation (the
 * `findMany()` this method uses requests no `include`, unlike `create()`'s
 * insert-and-read-back).
 */
function toIInlineCommentFromListRow(
  row: InlineCommentListRow,
): IInlineComment {
  // listByPageId only ever queries isInline: true, replyToId: null rows
  // (origin comments), which — like create()'s insert — always carry these
  // anchor fields together.
  if (
    row.creatorId == null ||
    row.quote == null ||
    row.prefix == null ||
    row.suffix == null ||
    row.approxOffset == null ||
    row.anchorOriginRevisionId == null
  ) {
    throw new Error(
      `Inline comment row '${row.id}' is missing required anchor fields`,
    );
  }

  return {
    id: row.id,
    pageId: row.pageId,
    creatorId: row.creatorId,
    comment: row.comment,
    anchorOriginRevisionId: row.anchorOriginRevisionId,
    anchor: {
      quote: row.quote,
      prefix: row.prefix,
      suffix: row.suffix,
      approxOffset: row.approxOffset,
    },
    resolvedById: row.resolvedById,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Maps a `listByPageId()` reply row (`InlineCommentListRow`) to
 * `InlineCommentReply` — the reply-side counterpart of
 * `toIInlineCommentFromListRow` above.
 */
function toInlineCommentReplyFromListRow(
  row: InlineCommentListRow,
): InlineCommentReply {
  // listByPageId only ever queries isInline: true, replyToId: { in: [...] }
  // rows (replies), which always carry creatorId/replyToId together — same
  // guarantee createReply()'s insert relies on.
  if (row.creatorId == null || row.replyToId == null) {
    throw new Error(
      `Inline comment reply row '${row.id}' is missing required fields`,
    );
  }

  return {
    id: row.id,
    pageId: row.pageId,
    creatorId: row.creatorId,
    comment: row.comment,
    replyToId: row.replyToId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// InlineCommentService
// ---------------------------------------------------------------------------

export class InlineCommentService {
  private readonly deps: InlineCommentServiceDeps;

  constructor(deps: InlineCommentServiceDeps) {
    this.deps = deps;
  }

  /**
   * Creates an origin (anchored) inline comment.
   *
   * - Rejects an empty `anchor.quote` (requirement 1.7 — the client already
   *   disables the create action on empty selection, but this is the
   *   server-side backstop design.md calls for).
   * - `anchor.quote`/`prefix`/`suffix` are persisted exactly as given — no
   *   normalization (requirement 1.4).
   * - `anchorOriginRevisionId` is set only here, from `input`, and this
   *   method never rewrites it afterward (requirement 5.4, 5.5 — there is
   *   no update path for it anywhere in this class).
   * - Records an `Activity` (`ACTION_INLINE_COMMENT_CREATE`) before calling
   *   `commentService.prepareMentionNotifications`, per design.md's
   *   Responsibilities & Constraints and the ordering `prepareMentionNotifications`
   *   requires (it takes `activityId` as an argument, so the activity must
   *   exist first). The activity id is minted here (rather than read off
   *   `createByParameters`'s return value) because the real extension's
   *   declared return type (`IActivity`) carries no `id` field, even though
   *   a row is created at runtime — see `IActivityParameters.id` doc in
   *   `~/server/models/activity.ts` for the caller-assigned-id contract this
   *   relies on.
   */
  async create(
    input: CreateInlineCommentInput,
    creatorId: string,
  ): Promise<IInlineComment> {
    if (input.anchor.quote === '') {
      throw new Error('anchor.quote must not be empty');
    }

    const created = await this.deps.prisma.comments.create({
      data: {
        pageId: input.pageId,
        creatorId,
        comment: input.comment,
        isInline: true,
        quote: input.anchor.quote,
        prefix: input.anchor.prefix,
        suffix: input.anchor.suffix,
        approxOffset: input.anchor.approxOffset,
        anchorOriginRevisionId: input.anchorOriginRevisionId,
      },
      include: { page: true },
    });

    const activityId = new Types.ObjectId().toString();

    // Activity first — see the method doc and
    // .claude/rules/activity-recording.md. Unlike a route-level `addActivity`
    // middleware call, this service mints the activity itself: it runs
    // outside any HTTP request context, so `ip`/`endpoint` are omitted
    // (IActivityParameters marks both optional for exactly this case).
    await this.deps.prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_INLINE_COMMENT_CREATE,
      user: creatorId,
      target: input.pageId,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      event: created.id,
      eventModel: SupportedEventModel.MODEL_COMMENT,
    });

    // Mention notification is best-effort: a failure here must not undo or
    // fail the comment creation that already succeeded (mirrors the legacy
    // `comments.add` route's `notifyMentions()` error handling in
    // `server/routes/comment.js`).
    try {
      const { notify } =
        await this.deps.commentService.prepareMentionNotifications(
          new Types.ObjectId(created.id),
          new Types.ObjectId(creatorId),
          new Types.ObjectId(activityId),
          toPageHasId(created.page),
        );
      await notify();
    } catch (err) {
      logger.error('Mention notification failed for inline comment', err);
    }

    return toIInlineComment(created);
  }

  /**
   * Creates a reply to an origin (anchored) inline comment.
   *
   * - Rejects `input.parentId` unless it references a row that is itself an
   *   origin inline comment (`isInline: true` and `replyToId: null`) — a
   *   regular non-inline comment, a reply's own id, or a nonexistent id are
   *   all rejected (design.md's Service Interface Preconditions, requirement
   *   1.8, 1.9).
   * - The inserted row leaves every anchor-related field unset (`quote`,
   *   `prefix`, `suffix`, `approxOffset`, `anchorOriginRevisionId`,
   *   `resolvedById`, `resolvedAt` all stay `null` — Prisma's `comments`
   *   model defaults them to `null` when omitted from `data`), matching
   *   design.md's Postconditions and requirement 1.9. No `page` relation is
   *   requested on this insert — the reply row itself never needs page data;
   *   only the *parent's* page (already fetched by the `findUnique` lookup
   *   above) is needed for `prepareMentionNotifications`.
   * - Records an `Activity` (`ACTION_INLINE_COMMENT_REPLY`) before calling
   *   `commentService.prepareMentionNotifications`, same ordering as
   *   `create()` and for the same reason (`prepareMentionNotifications`
   *   takes `activityId` as an argument, and the activity id is minted here
   *   for the same reason as in `create()` — see that method's doc).
   */
  async createReply(
    input: CreateInlineCommentReplyInput,
    creatorId: string,
  ): Promise<InlineCommentReply> {
    const parent = await this.deps.prisma.comments.findUnique({
      where: { id: input.parentId },
      include: { page: true },
    });

    if (parent == null || !parent.isInline || parent.replyToId != null) {
      throw new Error(
        `Inline comment '${input.parentId}' is not an origin inline comment`,
      );
    }

    const created = await this.deps.prisma.comments.create({
      data: {
        pageId: parent.pageId,
        creatorId,
        comment: input.comment,
        isInline: true,
        replyToId: input.parentId,
      },
    });

    const activityId = new Types.ObjectId().toString();

    // Activity first — see create()'s doc and .claude/rules/activity-recording.md.
    await this.deps.prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_INLINE_COMMENT_REPLY,
      user: creatorId,
      target: parent.pageId,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      event: created.id,
      eventModel: SupportedEventModel.MODEL_COMMENT,
    });

    // Mention notification is best-effort — see create()'s doc for why
    // failures here must not undo or fail the reply that already succeeded.
    try {
      const { notify } =
        await this.deps.commentService.prepareMentionNotifications(
          new Types.ObjectId(created.id),
          new Types.ObjectId(creatorId),
          new Types.ObjectId(activityId),
          toPageHasId(parent.page),
        );
      await notify();
    } catch (err) {
      logger.error('Mention notification failed for inline comment reply', err);
    }

    return toInlineCommentReply(created);
  }

  /**
   * Lists every inline comment for a page, with each origin comment's
   * replies nested under it (design.md's Service Interface —
   * `listByPageId(pageId: string): Promise<InlineComment[]>; // 各要素が返信のネスト配列を含む`).
   *
   * - No existing `comments` extension method fetches "origin + replies"
   *   together (`removeWithReplies` is delete-only — see design.md's
   *   Responsibilities & Constraints and `.claude/skills` testing note in
   *   this file's header comment), so this assembles the nesting itself:
   *   one `findMany()` for origin comments (`isInline: true`,
   *   `replyToId: null`), then one `findMany()` for every reply to any of
   *   those origins (`replyToId: { in: [...] }`) in a single round trip
   *   rather than one query per origin.
   * - Both queries order by `createdAt: 'desc'`, matching the direction the
   *   existing `findCommentsByPageId`/`findCommentsByRevisionId` extension
   *   methods already use for the page-footer comment thread (see
   *   `apps/app/src/features/comment/server/models/comment.ts`) — kept
   *   consistent with that convention since design.md does not pin a
   *   direction for this query (requirement 2.6 only says "作成日時順",
   *   without specifying ascending or descending).
   * - A reply is matched to its origin by `replyToId`; an origin with no
   *   matching rows gets an empty `replies` array (never `undefined`).
   */
  async listByPageId(pageId: string): Promise<InlineCommentWithReplies[]> {
    const originRows = await this.deps.prisma.comments.findMany({
      where: { pageId, isInline: true, replyToId: null },
      orderBy: { createdAt: 'desc' },
    });

    if (originRows.length === 0) {
      return [];
    }

    const replyRows = await this.deps.prisma.comments.findMany({
      where: {
        isInline: true,
        replyToId: { in: originRows.map((row) => row.id) },
      },
      orderBy: { createdAt: 'desc' },
    });

    const repliesByOriginId = replyRows.reduce((map, row) => {
      const reply = toInlineCommentReplyFromListRow(row);
      const existing = map.get(reply.replyToId) ?? [];
      map.set(reply.replyToId, [...existing, reply]);
      return map;
    }, new Map<string, InlineCommentReply[]>());

    return originRows.map((row) => ({
      ...toIInlineCommentFromListRow(row),
      replies: repliesByOriginId.get(row.id) ?? [],
    }));
  }
}
