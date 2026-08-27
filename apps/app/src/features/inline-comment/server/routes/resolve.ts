/**
 * PUT /_api/v3/inline-comments/:id/resolve — resolve/unresolve toggle.
 *
 * Middleware order (design.md's API Contract):
 *   accessTokenParser → loginRequired → express-validator → apiV3FormValidator
 *
 * `certifySharedPage` is intentionally NOT applied (requirement 6.1). `addActivity`
 * is also intentionally NOT applied — see create.ts's file doc for why (same
 * reasoning applies to `InlineCommentService.setResolved()`).
 *
 * Authorization: design.md's Security Considerations state the resolve toggle is
 * available to any logged-in user with page-comment permission, not restricted to
 * the origin comment's creator. This route checks page view permission the same way
 * create-reply.ts does (`:id` -> resolve its `pageId` -> viewer-filtered lookup) and
 * does not add a creator-only restriction.
 *
 * `:id` / 400-vs-404 split: same reasoning as create-reply.ts — a `findUnique`
 * distinguishes "id does not exist" (404) from "id exists but is not an origin
 * inline comment" (400), matching design.md's literal API Contract for this
 * endpoint ("400（`:id`が返信）, ..., 404").
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
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { ResolveInlineCommentRequestBody } from '../../interfaces/dto/resolve-inline-comment';
import { InlineCommentService } from '../service/inline-comment-service';

const logger = loggerFactory('growi:routes:apiv3:inline-comments:resolve');

type Req = Request<
  { id: string },
  ApiV3Response,
  ResolveInlineCommentRequestBody
> & {
  user?: HydratedDocument<IUser>;
};

const validator = [
  param('id').isMongoId().withMessage('id must be a valid MongoId'),
  body('resolved').isBoolean().withMessage('resolved must be a boolean'),
];

/**
 * Factory function that wires the inline-comment resolve-toggle route.
 *
 * @returns Express RequestHandler array to be spread into router.put().
 */
export const resolveInlineCommentRouteHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, false);
  const { pageService, pageGrantService } = crowi;

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
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
      const { resolved } = req.body;

      const target = await prisma.comments.findUnique({
        where: { id },
        select: { pageId: true, isInline: true, replyToId: true },
      });

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

      // Viewer-filtered lookup — see create.ts's file doc / page-write-action-403-404.md.
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

      const service = new InlineCommentService({
        prisma,
        commentService: crowi.commentService,
      });

      try {
        const inlineComment = await service.setResolved(
          id,
          resolved,
          user._id.toString(),
        );
        return res.apiv3({ inlineComment });
      } catch (err) {
        // The precondition (target not an origin comment) was already checked
        // above, so an Error here can only come from a race — see
        // create-reply.ts's equivalent comment.
        logger.error('Failed to toggle inline comment resolved state', err);
        return res.apiv3Err(
          new ErrorV3(
            err instanceof Error
              ? err.message
              : 'Failed to toggle inline comment resolved state',
            'inline-comment-resolve-failed',
          ),
          400,
        );
      }
    },
  ];
};
