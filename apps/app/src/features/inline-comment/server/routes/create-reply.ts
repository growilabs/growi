/**
 * POST /_api/v3/inline-comments/:id/replies — reply-to-inline-comment creation.
 *
 * `:id` names an origin inline comment, not a page, so this route cannot run
 * the page-permission check directly off the request — it resolves `:id`'s
 * `pageId` via `findUnique` first, then:
 *   - `:id` does not exist at all → 404
 *   - `:id` exists but is not an origin inline comment → 400
 * `InlineCommentService.createReply()` re-validates the same precondition
 * internally (its own `findUnique`) — a small duplicated query, kept so the
 * service's own precondition contract stays intact for other callers.
 *
 * `excludeReadOnlyUserIfCommentNotAllowed` is the same middleware normal
 * comments use for `/comments.add`, placed right after `loginRequired` — this
 * makes the read-only-user restriction a server-side guarantee, not only a
 * client-side affordance a direct API call could bypass (same pattern as
 * update.ts).
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

import type { CreateInlineCommentReplyRequestBody } from '../../interfaces/dto/create-inline-comment-reply';
import { InlineCommentService } from '../service/inline-comment-service';

const logger = loggerFactory('growi:routes:apiv3:inline-comments:create-reply');

type Req = Request<
  { id: string },
  ApiV3Response,
  CreateInlineCommentReplyRequestBody
> & {
  user?: HydratedDocument<IUser>;
};

const validator = [
  param('id').isMongoId().withMessage('id must be a valid MongoId'),
  body('comment').isString().withMessage('comment must be a string'),
];

export const createInlineCommentReplyRouteHandlersFactory = (
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

      const parentId = req.params.id;
      const { comment } = req.body;

      const parent = await prisma.comments.findUnique({
        where: { id: parentId },
        select: { pageId: true, isInline: true, replyToId: true },
      });

      // Runs before the comment-existence/shape check below, whenever a
      // pageId is known, so an authenticated-but-unauthorized caller can't
      // use this endpoint as an existence oracle (see page-write-action-403-404.md).
      if (parent != null) {
        const { meta } = await findPageAndMetaDataByViewer(
          pageService,
          pageGrantService,
          { pageId: parent.pageId, path: null, user, basicOnly: true },
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

      if (parent == null) {
        return res.apiv3Err(
          new ErrorV3(
            `Inline comment '${parentId}' is not found`,
            'inline-comment-not-found',
          ),
          404,
        );
      }

      if (!parent.isInline || parent.replyToId != null) {
        return res.apiv3Err(
          new ErrorV3(
            `Inline comment '${parentId}' is not an origin inline comment`,
            'inline-comment-not-origin',
          ),
          400,
        );
      }

      const service = new InlineCommentService({
        prisma,
        commentService: crowi.commentService,
      });

      try {
        const inlineCommentReply = await service.createReply(
          { parentId, comment },
          user._id.toString(),
        );
        return res.apiv3({ inlineCommentReply }, 201);
      } catch (err) {
        // The precondition was already checked above, so an Error here can
        // only come from a race (the parent row changed/vanished meanwhile).
        logger.error('Failed to create inline comment reply', err);
        return res.apiv3Err(
          new ErrorV3(
            err instanceof Error
              ? err.message
              : 'Failed to create inline comment reply',
            'inline-comment-reply-create-failed',
          ),
          400,
        );
      }
    },
  ];
};
