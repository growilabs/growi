/**
 * PUT /_api/v3/inline-comments/replies/:id — reply body edit.
 *
 * Mirrors update.ts exactly, except the shape check is inverted (`:id` must
 * be a reply — `replyToId != null` — rather than an origin comment) and the
 * route delegates to `InlineCommentService.updateReply()` instead of
 * `updateComment()`. See update.ts's file header for the shared reasoning
 * (middleware order including `excludeReadOnlyUserIfCommentNotAllowed`, why
 * `certifySharedPage`/`addActivity` are not applied, and why this route
 * performs its own creatorId check rather than relying solely on the
 * service's precondition check).
 */

import assert from 'node:assert';
import type { IUser } from '@growi/core';
import { isIPageNotFoundInfo, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body, param } from 'express-validator';
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

import type { UpdateInlineCommentReplyRequestBody } from '../../interfaces/dto/update-inline-comment-reply';
import { InlineCommentService } from '../service/inline-comment-service';

const logger = loggerFactory('growi:routes:apiv3:inline-comments:update-reply');

type Req = Request<
  { id: string },
  ApiV3Response,
  UpdateInlineCommentReplyRequestBody
> & {
  user?: HydratedDocument<IUser>;
};

const validator = [
  param('id').isMongoId().withMessage('id must be a valid MongoId'),
  body('comment')
    .isString()
    .notEmpty()
    .withMessage('comment must be a non-empty string'),
];

export const updateInlineCommentReplyRouteHandlersFactory = (
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
      const { comment } = req.body;

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

      // Inverted shape check from update.ts: :id must BE a reply here.
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
        const inlineCommentReply = await service.updateReply(
          id,
          comment,
          user._id.toString(),
        );
        return res.apiv3({ inlineCommentReply });
      } catch (err) {
        // Preconditions were already checked above; an Error here can only come from a race.
        logger.error('Failed to update inline comment reply', err);
        return res.apiv3Err(
          new ErrorV3(
            err instanceof Error
              ? err.message
              : 'Failed to update inline comment reply',
            'inline-comment-update-failed',
          ),
          400,
        );
      }
    },
  ];
};
