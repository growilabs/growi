/**
 * InlineCommentService — persistence, Activity recording, and mention-notification
 * kickoff for inline comments (design.md: "InlineCommentService").
 *
 * This is the sole write path for `comments` rows with `isInline: true`
 * (design.md: Responsibilities & Constraints). `create()` is implemented here;
 * `createReply`/`listByPageId`/`setResolved` (design.md's Service Interface)
 * are added by later tasks (3.2–3.4) as sibling methods on this same class —
 * this file is structured so those additions don't need to touch `create()`.
 */

import type { IPageHasId } from '@growi/core';
import { Types } from 'mongoose';

import {
  SupportedAction,
  SupportedEventModel,
  SupportedTargetModel,
} from '~/interfaces/activity';
import type { IActivityParameters } from '~/server/models/activity';
import type CommentService from '~/server/service/comment';
import loggerFactory from '~/utils/logger';

import type { IInlineComment, InlineCommentAnchor } from '../../interfaces';

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
// `prisma` is intentionally narrowed to only the two operations this
// service needs, rather than the full generated Prisma client: `create`
// (with `include: { page: true }`, so the row needed by
// `prepareMentionNotifications` comes back in the same round trip instead
// of a second dependency for fetching the page) and `activities.createByParameters`
// (the same direct-insert path other non-middleware Activity writers use —
// see `.claude/rules/activity-recording.md` and `attachment-snapshot.ts`).
// ---------------------------------------------------------------------------

/**
 * The `comments` row shape this service reads back after `create()`,
 * narrowed to the fields it actually uses. Mirrors the Prisma `comments`
 * model (schema.prisma) plus the `page` relation pulled in via `include`.
 */
export interface InlineCommentCreateResult {
  id: string;
  pageId: string;
  creatorId: string | null;
  comment: string;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  approxOffset: number | null;
  anchorOriginRevisionId: string | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * The related `pages` row. Typed loosely here (not `IPageHasId`) because
   * this is the raw Prisma shape (`id`, not `_id`); `toPageHasId` below
   * adapts it for `prepareMentionNotifications`.
   */
  page: { id: string } & Record<string, unknown>;
}

export interface InlineCommentServicePrisma {
  comments: {
    create(args: {
      data: {
        pageId: string;
        creatorId: string;
        comment: string;
        isInline: true;
        quote: string;
        prefix: string;
        suffix: string;
        approxOffset: number;
        anchorOriginRevisionId: string;
      };
      include: { page: true };
    }): Promise<InlineCommentCreateResult>;
  };
  activities: {
    createByParameters(params: IActivityParameters): Promise<{ id: string }>;
  };
}

export interface InlineCommentServiceDeps {
  prisma: InlineCommentServicePrisma;
  commentService: Pick<CommentService, 'prepareMentionNotifications'>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Adapts a Prisma `pages` row (as returned via `comments.create`'s
 * `include: { page: true }`) to the Mongoose-era `IPageHasId` shape that
 * `CommentService.prepareMentionNotifications` still expects. GROWI's
 * `$allModels` Prisma extension (`~/utils/prisma`) already attaches a
 * computed `_id` alias for exactly this kind of legacy-shape compatibility,
 * but `InlineCommentServicePrisma` deliberately does not depend on that
 * extension's type surface (it is typed loosely as `Record<string, unknown>`
 * to keep this service's own Prisma dependency narrow and mockable), so the
 * alias is added explicitly here instead of relied upon implicitly.
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
   *   exist first).
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

    // Activity first — see the method doc and
    // .claude/rules/activity-recording.md. Unlike a route-level `addActivity`
    // middleware call, this service mints the activity itself: it runs
    // outside any HTTP request context, so `ip`/`endpoint` are omitted
    // (IActivityParameters marks both optional for exactly this case).
    const activity = await this.deps.prisma.activities.createByParameters({
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
          new Types.ObjectId(activity.id),
          toPageHasId(created.page),
        );
      await notify();
    } catch (err) {
      logger.error('Mention notification failed for inline comment', err);
    }

    return toIInlineComment(created);
  }
}
