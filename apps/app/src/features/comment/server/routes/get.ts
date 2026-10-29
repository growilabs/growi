import type { IUser } from '@growi/core';
import { SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { param, query } from 'express-validator';
import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { setup as certifySharedPageFactory } from '~/server/middlewares/certify-shared-page';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  GetCommentRequestQuery,
  GetCommentResponseBody,
} from '../../interfaces';
import { canViewCommentsOfPage } from '../authorization/can-view-comments-of-page';
import { getCommentListItem } from '../service/comment-get';
import { notFoundOrForbidden } from './not-found-or-forbidden';

const logger = loggerFactory('growi:routes:apiv3:comments:get');

type Req = Request<
  { id: string },
  ApiV3Response,
  unknown,
  GetCommentRequestQuery
> & {
  user?: HydratedDocument<IUser>;
  isSharedPage?: boolean;
};

/**
 * @swagger
 *
 *    /comments/{id}:
 *      get:
 *        tags: [Comments]
 *        summary: Get one comment of a page
 *        description: >
 *          Returns one comment of a page, in the same shape as an item of
 *          `GET /comments`. Both regular and inline comments (and replies to
 *          either) can be read; use `isInline` to tell them apart. The comment
 *          must belong to the page given by `pageId`; otherwise the response is
 *          404 `notfound_or_forbidden`. `revisionId` is not accepted: filtering
 *          by revision is available only on `GET /comments`. Access is allowed
 *          to a user who can view the page, or to anyone holding a valid
 *          `shareLinkId` for the page, in which case only comments of that page
 *          are returned. Authentication with an access token requires the
 *          scope `read:features:page`.
 *        parameters:
 *          - in: path
 *            name: id
 *            required: true
 *            schema:
 *              type: string
 *            description: ID of the comment.
 *          - in: query
 *            name: pageId
 *            required: true
 *            schema:
 *              type: string
 *            description: ID of the page the comment belongs to.
 *          - in: query
 *            name: shareLinkId
 *            schema:
 *              type: string
 *            description: >
 *              ID of a share link for the page. Used only to authorize access for
 *              users who cannot view the page directly.
 *        responses:
 *          200:
 *            description: The comment.
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  required:
 *                    - comment
 *                  properties:
 *                    comment:
 *                      $ref: '#/components/schemas/CommentListItem'
 *          400:
 *            description: A parameter is missing or is not a valid ID.
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 *          403:
 *            description: Not authenticated, or the access token lacks the required scope.
 *          404:
 *            description: >
 *              The comment does not exist, does not belong to the page, or the
 *              caller may not view the page. These cases are deliberately
 *              indistinguishable (error code `notfound_or_forbidden`).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 *          500:
 *            description: Unexpected failure (error code `comment-get-failed`).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 */
export const getCommentRouteHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, true);
  const certifySharedPage = certifySharedPageFactory(crowi);
  const { pageService, pageGrantService } = crowi;

  // isString() before isMongoId() rejects arrays / objects built by the qs
  // parser (e.g. `pageId[$ne]=`) before they reach certifySharedPage's query.
  const validator = [
    param('id').isMongoId(),
    query('pageId').isString().bail().isMongoId(),
    query('shareLinkId').optional().isString().bail().isMongoId(),
  ];

  return [
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    ...validator,
    apiV3FormValidator,
    certifySharedPage,
    loginRequired,
    async (req: Req, res: ApiV3Response) => {
      try {
        const { pageId } = req.query;
        if (
          !(await canViewCommentsOfPage(
            { pageService, pageGrantService },
            { req, pageId },
          ))
        ) {
          return res.apiv3Err(notFoundOrForbidden(), 404);
        }

        const comment = await getCommentListItem(
          { prisma },
          {
            commentId: req.params.id,
            pageId,
            viewerId: req.user != null ? String(req.user._id) : null,
          },
        );
        if (comment == null) {
          return res.apiv3Err(notFoundOrForbidden(), 404);
        }

        const body: GetCommentResponseBody = { comment };
        return res.apiv3(body);
      } catch (err) {
        logger.error('Failed to get comment', err);
        return res.apiv3Err(
          new ErrorV3('Failed to get comment', 'comment-get-failed'),
          500,
        );
      }
    },
  ];
};
