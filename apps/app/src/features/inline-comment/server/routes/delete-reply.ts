/**
 * DELETE /_api/v3/inline-comments/replies/:id — reply delete (surgical, no
 * cascade — a plain `prisma.comments.delete`, unlike `deleteComment()`'s
 * `removeWithReplies`).
 *
 * Mirrors delete.ts exactly, except the shape check is inverted (`:id` must
 * be a reply, not an origin comment) and it delegates to
 * `InlineCommentService.deleteReply()` instead of `deleteComment()`. See
 * delete.ts's file header for the shared reasoning.
 */

import assert from 'node:assert';
import type { IUser } from '@growi/core';
import { isIPageNotFoundInfo, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { param } from 'express-validator';
import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUserIfCommentNotAllowed } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { InlineCommentService } from '../service/inline-comment-service';

const logger = loggerFactory('growi:routes:apiv3:inline-comments:delete-reply');

type Req = Request<{ id: string }, ApiV3Response> & {
  user?: HydratedDocument<IUser>;
};

const validator = [
  param('id').isMongoId().withMessage('id must be a valid MongoId'),
];

export const deleteInlineCommentReplyRouteHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, false);
  const { pageService, pageGrantService } = crowi;

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    excludeReadOnlyUserIfCommentNotAllowed,
    ...validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { user } = req;
      assert(
        user != null,
        'user is required (ensured by loginRequired middleware)',
      );
      assert(
        crowi.commentService != null,
        'commentService must be initialized',
      );

      const id = req.params.id;

      const target = await prisma.comments.findUnique({
        where: { id },
        select: {
          pageId: true,
          isInline: true,
          replyToId: true,
          creatorId: true,
        },
      });

      // See apps/app/.claude/rules/page-write-action-403-404.md.
      if (target != null) {
        const { meta } = await findPageAndMetaDataByViewer(
          pageService,
          pageGrantService,
          { pageId: target.pageId, path: null, user, basicOnly: true },
        );
        if (isIPageNotFoundInfo(meta)) {
          return res.apiv3Err(
            new ErrorV3(
              'Page is not found or forbidden',
              'notfound_or_forbidden',
            ),
            404,
          );
        }
      }

      if (target == null) {
        return res.apiv3Err(
          new ErrorV3(
            `Inline comment reply '${id}' is not found`,
            'inline-comment-not-found',
          ),
          404,
        );
      }

      // Inverted shape check from delete.ts: :id must BE a reply here.
      if (!target.isInline || target.replyToId == null) {
        return res.apiv3Err(
          new ErrorV3(
            `Inline comment '${id}' is not a reply`,
            'inline-comment-not-reply',
          ),
          400,
        );
      }

      if (target.creatorId !== user._id.toString()) {
        return res.apiv3Err(
          new ErrorV3(
            `Inline comment reply '${id}' is not owned by the requester`,
            'inline-comment-forbidden',
          ),
          403,
        );
      }

      const service = new InlineCommentService({
        prisma,
        commentService: crowi.commentService,
      });

      try {
        await service.deleteReply(id, user._id.toString());
        return res.apiv3({});
      } catch (err) {
        // Preconditions were already checked above; an Error here can only come from a race.
        logger.error('Failed to delete inline comment reply', err);
        return res.apiv3Err(
          new ErrorV3(
            err instanceof Error
              ? err.message
              : 'Failed to delete inline comment reply',
            'inline-comment-delete-failed',
          ),
          400,
        );
      }
    },
  ];
};
