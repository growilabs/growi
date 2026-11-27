/**
 * PUT /_api/v3/inline-comments/:id/resolve — resolve/unresolve toggle.
 *
 * `certifySharedPage`/`addActivity` are intentionally NOT applied — see
 * create.ts's file doc.
 *
 * Authorization: the resolve toggle is available to any logged-in user with
 * page-comment permission, not restricted to the origin comment's creator.
 * This route checks page view permission the same way create-reply.ts does
 * and adds no creator-only restriction.
 *
 * `excludeReadOnlyUserIfCommentNotAllowed` is the same middleware normal
 * comments use for `/comments.update`, placed right after `loginRequired` —
 * see update.ts's file doc for why this makes the read-only-user restriction
 * a server-side guarantee, not only a client-side affordance.
 *
 * `findUnique` distinguishes "id does not exist" (404) from "id exists but
 * isn't an origin inline comment" (400) — same reasoning as create-reply.ts.
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

import type { ResolveInlineCommentRequestBody } from '../../interfaces/dto/resolve-inline-comment';
import { InlineCommentService } from '../service/inline-comment-service';
import { updatePageCommentCount } from '../update-page-comment-count';

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
 * @swagger
 *
 *    /inline-comments/{id}/resolve:
 *      put:
 *        tags: [Comments]
 *        summary: Resolve or unresolve an inline comment thread
 *        description: >
 *          Marks an origin inline comment as resolved or unresolved. Only origin
 *          comments have a resolved state. Anyone who may comment on the page may do
 *          this, not only the creator. Requires login, or an access token with the scope
 *          `write:features:page`, and permission to view the page. Not available through
 *          a share link. Read-only users are refused unless read-only users are allowed
 *          to comment.
 *        parameters:
 *          - in: path
 *            name: id
 *            required: true
 *            schema:
 *              type: string
 *            description: ID of the origin inline comment.
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                required:
 *                  - resolved
 *                properties:
 *                  resolved:
 *                    type: boolean
 *                    description: true to resolve the thread, false to reopen it.
 *        responses:
 *          200:
 *            description: The updated inline comment.
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  required:
 *                    - inlineComment
 *                  properties:
 *                    inlineComment:
 *                      $ref: '#/components/schemas/InlineComment'
 *          400:
 *            description: >
 *              Invalid input, or the caller is a read-only user (code
 *              `validation_failed`); `id` is not an origin inline comment (code
 *              `inline-comment-not-origin`); the state could not be changed (code
 *              `inline-comment-resolve-failed`).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 *          403:
 *            description: Not authenticated, or the access token lacks the required scope.
 *          404:
 *            description: >
 *              The comment does not exist (code `inline-comment-not-found`), or its page
 *              does not exist or the caller may not view it (code
 *              `notfound_or_forbidden`; these two page cases are indistinguishable).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 */
export const resolveInlineCommentRouteHandlersFactory = (
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
      const { resolved } = req.body;

      const target = await prisma.comments.findUnique({
        where: { id },
        select: { pageId: true, isInline: true, replyToId: true },
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

      const service = new InlineCommentService({
        prisma,
        commentService: crowi.commentService,
        updateCommentCount: updatePageCommentCount,
      });

      try {
        const inlineComment = await service.setResolved(
          id,
          resolved,
          user._id.toString(),
        );
        return res.apiv3({ inlineComment });
      } catch (err) {
        // Preconditions were already checked above; an Error here can only come from a race.
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
