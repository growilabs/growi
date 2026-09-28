/**
 * Sole write path for `comments` rows with `isInline: true` — persistence,
 * Activity recording, and mention-notification kickoff for inline comments.
 */

import type { IPageHasId, IUserHasId } from '@growi/core';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
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

export interface CreateInlineCommentInput {
  pageId: string;
  anchorOriginRevisionId: string;
  comment: string;
  anchor: InlineCommentAnchor;
}

export interface CreateInlineCommentReplyInput {
  parentId: string;
  comment: string;
}

// ---------------------------------------------------------------------------
// Dependencies
//
// Dependencies are passed in via the constructor rather than importing
// `Crowi` or the shared `prisma` singleton directly (services must not
// import the Crowi class — see apps/app/.claude/rules/esm-authoring.md).
//
// Row/result types below are derived from the real `PrismaClient` type via
// `Prisma.Result<...>` rather than hand-written, so they can't drift from
// what Prisma actually returns.
// ---------------------------------------------------------------------------

type InlineCommentCreateResult = Prisma.Result<
  PrismaClient['comments'],
  { include: { page: true } },
  'create'
>;

// No `page` relation here: prepareMentionNotifications needs the *parent's*
// page, already available from createReply()'s own findUnique lookup.
type InlineCommentReplyCreateResult = Prisma.Result<
  PrismaClient['comments'],
  object,
  'create'
>;

type InlineCommentListRow = Prisma.Result<
  PrismaClient['comments'],
  { include: { creator: true } },
  'findMany'
>[number];

type InlineCommentUpdateResult = Prisma.Result<
  PrismaClient['comments'],
  object,
  'update'
>;

export interface InlineCommentServiceDeps {
  prisma: Pick<PrismaClient, 'comments' | 'activities'>;
  commentService: Pick<CommentService, 'prepareMentionNotifications'>;
}

type InlineCommentReplyUpdateResult = Prisma.Result<
  PrismaClient['comments'],
  object,
  'update'
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adapts a Prisma `pages` row to the Mongoose-era `IPageHasId` shape that
 * `CommentService.prepareMentionNotifications` still expects. The `$allModels`
 * extension (`~/utils/prisma`) adds a computed `_id` alias at runtime, but
 * that extension applies to the top-level delegate, not to a nested relation
 * pulled in via `include` — so the type here doesn't see it, and `_id` has to
 * be added explicitly rather than relied on.
 */
function toPageHasId(
  page: { id: string } & Record<string, unknown>,
): IPageHasId {
  return { ...page, _id: page.id } as unknown as IPageHasId;
}

function toIInlineComment(row: InlineCommentCreateResult): IInlineComment {
  // create() always writes these fields together, so a row it just inserted
  // is guaranteed to have them.
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
    creator: null, // no `creator` include on this insert; the client re-fetches the list right after create()
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
  if (row.creatorId == null || row.replyToId == null) {
    throw new Error(
      `Inline comment reply row '${row.id}' is missing required fields`,
    );
  }

  return {
    id: row.id,
    pageId: row.pageId,
    creatorId: row.creatorId,
    creator: null, // no `creator` include on this insert
    comment: row.comment,
    replyToId: row.replyToId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Returns `null` (rather than throwing) for a row missing a required anchor
 * field, instead of failing the whole page's comment list for every viewer
 * over one malformed row (manual DB edit, write-path bug, schema drift).
 */
function toIInlineCommentFromListRow(
  row: InlineCommentListRow,
): IInlineComment | null {
  if (
    row.creatorId == null ||
    row.quote == null ||
    row.prefix == null ||
    row.suffix == null ||
    row.approxOffset == null ||
    row.anchorOriginRevisionId == null
  ) {
    logger.warn(
      `Skipping malformed inline comment row '${row.id}': missing required anchor field(s)`,
    );
    return null;
  }

  return {
    id: row.id,
    pageId: row.pageId,
    creatorId: row.creatorId,
    creator:
      row.creator != null
        ? serializeUserSecurely(row.creator as IUserHasId)
        : null,
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

/** Reply-row counterpart of `toIInlineCommentFromListRow` — same null-on-malformed-row behavior. */
function toInlineCommentReplyFromListRow(
  row: InlineCommentListRow,
): InlineCommentReply | null {
  if (row.creatorId == null || row.replyToId == null) {
    logger.warn(
      `Skipping malformed inline comment reply row '${row.id}': missing required field(s)`,
    );
    return null;
  }

  return {
    id: row.id,
    pageId: row.pageId,
    creatorId: row.creatorId,
    creator:
      row.creator != null
        ? serializeUserSecurely(row.creator as IUserHasId)
        : null,
    comment: row.comment,
    replyToId: row.replyToId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toIInlineCommentFromUpdateResult(
  row: InlineCommentUpdateResult,
): IInlineComment {
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
    creator: null,
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

function toInlineCommentReplyFromUpdateResult(
  row: InlineCommentReplyUpdateResult,
): InlineCommentReply {
  if (row.creatorId == null || row.replyToId == null) {
    throw new Error(
      `Inline comment reply row '${row.id}' is missing required fields`,
    );
  }

  return {
    id: row.id,
    pageId: row.pageId,
    creatorId: row.creatorId,
    creator: null,
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
   * Creates an origin (anchored) inline comment. `anchor.quote`/`prefix`/
   * `suffix` are persisted exactly as given, with no normalization.
   *
   * The activity id is minted here (rather than read off
   * `createByParameters`'s return value) because that method's declared
   * return type carries no `id` field even though a row is created at
   * runtime — see `IActivityParameters.id` in `~/server/models/activity.ts`
   * for the caller-assigned-id contract this relies on.
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
        // Explicit null, not omitted: an omitted field is absent from the
        // MongoDB document, and Prisma's MongoDB connector does not match an
        // absent field against `where: { replyToId: null }` — the filter
        // listByPageId() uses to select origin comments.
        replyToId: null,
        quote: input.anchor.quote,
        prefix: input.anchor.prefix,
        suffix: input.anchor.suffix,
        approxOffset: input.anchor.approxOffset,
        anchorOriginRevisionId: input.anchorOriginRevisionId,
      },
      include: { page: true },
    });

    const activityId = new Types.ObjectId().toString();

    // Mints the activity itself (no request context here, so ip/endpoint
    // are omitted — see .claude/rules/activity-recording.md).
    await this.deps.prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_INLINE_COMMENT_CREATE,
      user: creatorId,
      target: input.pageId,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      event: created.id,
      eventModel: SupportedEventModel.MODEL_COMMENT,
    });

    // Best-effort: a notification failure must not undo the comment already created.
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
   * Creates a reply to an origin (anchored) inline comment. Rejects
   * `input.parentId` unless it references an origin comment itself
   * (`isInline: true`, `replyToId: null`) — a regular comment, another
   * reply, or a nonexistent id are all rejected.
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

    await this.deps.prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_INLINE_COMMENT_REPLY,
      user: creatorId,
      target: parent.pageId,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      event: created.id,
      eventModel: SupportedEventModel.MODEL_COMMENT,
    });

    // Best-effort, same as create() above.
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
   * replies nested under it. Fetches origins and replies in two `findMany()`
   * calls (one round trip for all replies, not one per origin). Both queries
   * order by `createdAt: 'desc'`; display order is a client-side concern
   * (see `InlineCommentReplies.tsx`, which reverses `replies` before render).
   */
  async listByPageId(pageId: string): Promise<InlineCommentWithReplies[]> {
    const originRows = await this.deps.prisma.comments.findMany({
      where: { pageId, isInline: true, replyToId: null },
      include: { creator: true },
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
      include: { creator: true },
      orderBy: { createdAt: 'desc' },
    });

    const repliesByOriginId = replyRows.reduce((map, row) => {
      const reply = toInlineCommentReplyFromListRow(row);
      if (reply == null) {
        return map;
      }
      const existing = map.get(reply.replyToId) ?? [];
      map.set(reply.replyToId, [...existing, reply]);
      return map;
    }, new Map<string, InlineCommentReply[]>());

    return originRows
      .map((row) => {
        const comment = toIInlineCommentFromListRow(row);
        if (comment == null) {
          return null;
        }
        return { ...comment, replies: repliesByOriginId.get(row.id) ?? [] };
      })
      .filter((entry): entry is InlineCommentWithReplies => entry != null);
  }

  /**
   * Toggles an origin (anchored) inline comment's resolved state.
   *
   * Authorization (does `actorId` hold comment permission on the page) is
   * deliberately NOT re-checked here — the route layer owns that check;
   * `actorId` is used only to attribute the Activity record.
   */
  async setResolved(
    id: string,
    resolved: boolean,
    actorId: string,
  ): Promise<IInlineComment> {
    const target = await this.deps.prisma.comments.findUnique({
      where: { id },
    });

    if (target == null || !target.isInline || target.replyToId != null) {
      throw new Error(`Inline comment '${id}' is not an origin inline comment`);
    }

    const updated = await this.deps.prisma.comments.update({
      where: { id },
      data: resolved
        ? { resolvedById: actorId, resolvedAt: new Date() }
        : { resolvedById: null, resolvedAt: null },
    });

    const activityId = new Types.ObjectId().toString();

    await this.deps.prisma.activities.createByParameters({
      id: activityId,
      action: resolved
        ? SupportedAction.ACTION_INLINE_COMMENT_RESOLVE
        : SupportedAction.ACTION_INLINE_COMMENT_UNRESOLVE,
      user: actorId,
      target: updated.pageId,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      event: updated.id,
      eventModel: SupportedEventModel.MODEL_COMMENT,
    });

    return toIInlineCommentFromUpdateResult(updated);
  }

  /**
   * Updates the body of an origin (anchored) inline comment. Rejects when
   * `actorId` doesn't match the row's `creatorId` — the service-layer half
   * of defense-in-depth authorization (the route layer re-checks the same
   * thing). Only `comment` is written; anchor/resolved fields are untouched.
   */
  async updateComment(
    id: string,
    comment: string,
    actorId: string,
  ): Promise<IInlineComment> {
    const target = await this.deps.prisma.comments.findUnique({
      where: { id },
    });

    if (
      target == null ||
      !target.isInline ||
      target.replyToId != null ||
      target.creatorId !== actorId
    ) {
      throw new Error(
        `Inline comment '${id}' is not an origin inline comment owned by '${actorId}'`,
      );
    }

    const updated = await this.deps.prisma.comments.update({
      where: { id },
      data: { comment },
    });

    const activityId = new Types.ObjectId().toString();

    await this.deps.prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_INLINE_COMMENT_UPDATE,
      user: actorId,
      target: updated.pageId,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      event: updated.id,
      eventModel: SupportedEventModel.MODEL_COMMENT,
    });

    return toIInlineCommentFromUpdateResult(updated);
  }

  /** Mirrors `updateComment()`, but targets a reply row (`replyToId != null`). */
  async updateReply(
    id: string,
    comment: string,
    actorId: string,
  ): Promise<InlineCommentReply> {
    const target = await this.deps.prisma.comments.findUnique({
      where: { id },
    });

    if (
      target == null ||
      !target.isInline ||
      target.replyToId == null ||
      target.creatorId !== actorId
    ) {
      throw new Error(
        `Inline comment reply '${id}' is not a reply owned by '${actorId}'`,
      );
    }

    const updated = await this.deps.prisma.comments.update({
      where: { id },
      data: { comment },
    });

    const activityId = new Types.ObjectId().toString();

    await this.deps.prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_INLINE_COMMENT_REPLY_UPDATE,
      user: actorId,
      target: updated.pageId,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      event: updated.id,
      eventModel: SupportedEventModel.MODEL_COMMENT,
    });

    return toInlineCommentReplyFromUpdateResult(updated);
  }

  /**
   * Deletes an origin (anchored) inline comment together with its replies,
   * via `prisma.comments.removeWithReplies(id)` (one transaction for the
   * origin and every reply).
   */
  async deleteComment(id: string, actorId: string): Promise<void> {
    const target = await this.deps.prisma.comments.findUnique({
      where: { id },
    });

    if (
      target == null ||
      !target.isInline ||
      target.replyToId != null ||
      target.creatorId !== actorId
    ) {
      throw new Error(
        `Inline comment '${id}' is not an origin inline comment owned by '${actorId}'`,
      );
    }

    await this.deps.prisma.comments.removeWithReplies(id);

    const activityId = new Types.ObjectId().toString();

    await this.deps.prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_INLINE_COMMENT_DELETE,
      user: actorId,
      target: target.pageId,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      event: target.id,
      eventModel: SupportedEventModel.MODEL_COMMENT,
    });
  }

  /** Deletes a single reply — no cascade needed, unlike `deleteComment()`. */
  async deleteReply(id: string, actorId: string): Promise<void> {
    const target = await this.deps.prisma.comments.findUnique({
      where: { id },
    });

    if (
      target == null ||
      !target.isInline ||
      target.replyToId == null ||
      target.creatorId !== actorId
    ) {
      throw new Error(
        `Inline comment reply '${id}' is not a reply owned by '${actorId}'`,
      );
    }

    await this.deps.prisma.comments.delete({ where: { id } });

    const activityId = new Types.ObjectId().toString();

    await this.deps.prisma.activities.createByParameters({
      id: activityId,
      action: SupportedAction.ACTION_INLINE_COMMENT_REPLY_DELETE,
      user: actorId,
      target: target.pageId,
      targetModel: SupportedTargetModel.MODEL_PAGE,
      event: target.id,
      eventModel: SupportedEventModel.MODEL_COMMENT,
    });
  }
}
