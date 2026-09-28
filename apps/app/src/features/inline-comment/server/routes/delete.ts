/**
 * DELETE /_api/v3/inline-comments/:id — origin comment delete (cascades to
 * its replies via `InlineCommentService.deleteComment()`'s
 * `removeWithReplies` call).
 *
 * `excludeReadOnlyUserIfCommentNotAllowed` is the same middleware normal
 * comments use for `/comments.remove`, placed right after `loginRequired` —
 * this makes the read-only-user restriction a server-side guarantee, not
 * only a client-side affordance a direct API call could bypass.
 *
 * `certifySharedPage`/`addActivity` are intentionally NOT applied — same
 * reasoning as update.ts's file doc. No request body DTO (`id` is a URL
 * param) and no meaningful response payload beyond `res.apiv3({})`.
 *
 * `findUnique` distinguishes "id does not exist" (404), "id exists but isn't
 * an origin inline comment" (400), and "id is an origin comment but the
 * requester isn't its creator" (403) — same reasoning as update.ts.
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

const logger = loggerFactory('growi:routes:apiv3:inline-comments:delete');

type Req = Request<{ id: string }, ApiV3Response> & {
  user?: HydratedDocument<IUser>;
};

const validator = [
  param('id').isMongoId().withMessage('id must be a valid MongoId'),
];

export const deleteInlineCommentRouteHandlersFactory = (
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
            `Inline comment '${id}' is not found`,
            'inline-comment-not-found',
          ),
          404,
        );
      }

      if (!target.isInline || target.replyToId != null) {
        return res.apiv3Err(
          new ErrorV3(
            `Inline comment '${id}' is not an origin inline comment`,
            'inline-comment-not-origin',
          ),
          400,
        );
      }

      if (target.creatorId !== user._id.toString()) {
        return res.apiv3Err(
          new ErrorV3(
            `Inline comment '${id}' is not owned by the requester`,
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
        await service.deleteComment(id, user._id.toString());
        return res.apiv3({});
      } catch (err) {
        // Preconditions were already checked above; an Error here can only come from a race.
        logger.error('Failed to delete inline comment', err);
        return res.apiv3Err(
          new ErrorV3(
            err instanceof Error
              ? err.message
              : 'Failed to delete inline comment',
            'inline-comment-delete-failed',
          ),
          400,
        );
      }
    },
  ];
};
