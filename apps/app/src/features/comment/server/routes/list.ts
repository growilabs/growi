import type { IUser } from '@growi/core';
import { isIPageNotFoundInfo, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query } from 'express-validator';
import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { setup as certifySharedPageFactory } from '~/server/middlewares/certify-shared-page';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type {
  ListCommentsRequestQuery,
  ListCommentsResponseBody,
} from '../../interfaces';
import { toCommentListItem } from '../serializers/to-comment-list-item';
import { type ListCommentsInput, listComments } from '../service/comment-list';

const logger = loggerFactory('growi:routes:apiv3:comments:list');

type Req = Request<
  Record<string, never>,
  ApiV3Response,
  unknown,
  ListCommentsRequestQuery
> & {
  user?: HydratedDocument<IUser>;
  isSharedPage?: boolean;
};

// Same body for "page missing", "page forbidden" and "revision not found" so
// the response never tells which one it was (rules/page-write-action-403-404.md).
const notFoundOrForbidden = (): ErrorV3 =>
  new ErrorV3('Page is not found or forbidden', 'notfound_or_forbidden');

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      CommentListItem:
 *        description: >
 *          A page comment, either a regular comment or an inline comment (a
 *          comment anchored to a quoted passage of the page body). Replies to
 *          either kind are returned as separate items linked by `replyToId`.
 *          Use `isInline` to tell the two kinds apart.
 *        type: object
 *        required:
 *          - _id
 *          - id
 *          - page
 *          - pageId
 *          - creator
 *          - creatorId
 *          - revision
 *          - revisionId
 *          - replyTo
 *          - replyToId
 *          - comment
 *          - commentPosition
 *          - createdAt
 *          - updatedAt
 *          - isInline
 *          - quote
 *          - prefix
 *          - suffix
 *          - approxOffset
 *          - anchorOriginRevisionId
 *          - resolvedById
 *          - resolvedAt
 *        properties:
 *          _id:
 *            type: string
 *            description: Comment ID (same value as `id`).
 *          id:
 *            type: string
 *            description: Comment ID.
 *          page:
 *            type: string
 *            description: ID of the page the comment belongs to (same value as `pageId`).
 *          pageId:
 *            type: string
 *            description: ID of the page the comment belongs to.
 *          creator:
 *            nullable: true
 *            description: >
 *              The author with credentials removed (the email address appears only
 *              when the author publishes it). Falls back to the author's ID string
 *              when the user record no longer exists, and is null when the
 *              comment has no author.
 *            oneOf:
 *              - type: object
 *                additionalProperties: true
 *              - type: string
 *          creatorId:
 *            type: string
 *            nullable: true
 *            description: ID of the author.
 *          revision:
 *            type: string
 *            nullable: true
 *            description: >
 *              ID of the page revision the comment was posted against (same value
 *              as `revisionId`).
 *          revisionId:
 *            type: string
 *            nullable: true
 *            description: ID of the page revision the comment was posted against.
 *          replyTo:
 *            type: string
 *            nullable: true
 *            description: ID of the comment this one replies to (same value as `replyToId`). Null for a top-level comment.
 *          replyToId:
 *            type: string
 *            nullable: true
 *            description: ID of the comment this one replies to. Null for a top-level comment.
 *          comment:
 *            type: string
 *            description: Comment body in Markdown.
 *          commentPosition:
 *            type: integer
 *            description: Legacy position field kept for compatibility with the legacy comments API.
 *          createdAt:
 *            type: string
 *            format: date-time
 *          updatedAt:
 *            type: string
 *            format: date-time
 *          isInline:
 *            type: boolean
 *            description: >
 *              Discriminator. `true` for an inline comment (or a reply to one),
 *              `false` for a regular comment. The inline-only fields below are
 *              null when this is `false`.
 *          quote:
 *            type: string
 *            nullable: true
 *            description: Inline only. The exact passage of the page body the comment is anchored to.
 *          prefix:
 *            type: string
 *            nullable: true
 *            description: Inline only. Text immediately before `quote`, used to re-locate the anchor after the page is edited.
 *          suffix:
 *            type: string
 *            nullable: true
 *            description: Inline only. Text immediately after `quote`, used to re-locate the anchor after the page is edited.
 *          approxOffset:
 *            type: integer
 *            nullable: true
 *            description: Inline only. Approximate character offset of `quote` in the body of the anchor's origin revision, used to disambiguate repeated passages.
 *          anchorOriginRevisionId:
 *            type: string
 *            nullable: true
 *            description: Inline only. ID of the revision in which the anchor (`quote`, `prefix`, `suffix`, `approxOffset`) was captured.
 *          resolvedById:
 *            type: string
 *            nullable: true
 *            description: Inline only. ID of the user who resolved the thread. Null while unresolved.
 *          resolvedAt:
 *            type: string
 *            format: date-time
 *            nullable: true
 *            description: Inline only. When the thread was resolved. Null while unresolved.
 */

/**
 * @swagger
 *
 *    /comments:
 *      get:
 *        tags: [Comments]
 *        summary: List the comments of a page
 *        description: >
 *          Returns the regular comments and the inline comments of a page, including
 *          replies, newest first (by creation time). Use `isInline` to tell them apart.
 *          When `revisionId` is given, only the comments created before the next
 *          revision of the page (the oldest revision created after the given one) are
 *          returned, whichever revision they were posted on. If the given revision is
 *          the latest one, all comments are returned. Access is allowed to a user who
 *          can view the page, or to anyone holding a valid `shareLinkId` for the page (in which
 *          case `revisionId` is ignored; `revisionId` yields 404 `notfound_or_forbidden`
 *          if the revision does not exist or belongs to another page). Authentication with an access token requires the scope
 *          `read:features:page`.
 *        parameters:
 *          - in: query
 *            name: pageId
 *            required: true
 *            schema:
 *              type: string
 *            description: ID of the page.
 *          - in: query
 *            name: revisionId
 *            schema:
 *              type: string
 *            description: ID of a revision of the page. Return only the comments created before the page's next revision after this one. Responds with 404 if the revision does not exist or belongs to another page.
 *          - in: query
 *            name: shareLinkId
 *            schema:
 *              type: string
 *            description: ID of a share link for the page. Used only to authorize access for users who cannot view the page directly.
 *        responses:
 *          200:
 *            description: The comments of the page, newest first.
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  required:
 *                    - comments
 *                  properties:
 *                    comments:
 *                      type: array
 *                      items:
 *                        $ref: '#/components/schemas/CommentListItem'
 *          400:
 *            description: A query parameter is missing or is not a valid ID.
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 *          403:
 *            description: Not authenticated, or the access token lacks the required scope.
 *          404:
 *            description: >
 *              The page or the revision does not exist, or the caller may not view the
 *              page. The two cases are deliberately indistinguishable (error code
 *              `notfound_or_forbidden`).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 *          500:
 *            description: Unexpected failure (error code `comment-list-failed`).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 */
export const listCommentsRouteHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, true);
  const certifySharedPage = certifySharedPageFactory(crowi);
  const { pageService, pageGrantService } = crowi;

  // isString() before isMongoId() rejects arrays / objects built by the qs
  // parser (e.g. `pageId[$ne]=`) before they reach certifySharedPage's query.
  const validator = [
    query('pageId').isString().bail().isMongoId(),
    query('revisionId').optional().isString().bail().isMongoId(),
    query('shareLinkId').optional().isString().bail().isMongoId(),
  ];

  // Trust only the flag set by certifySharedPage, which verified that the
  // share link belongs to this pageId; never the raw shareLinkId query.
  const canViewPage = async (req: Req): Promise<boolean> => {
    if (req.isSharedPage === true) {
      return true;
    }
    const { meta } = await findPageAndMetaDataByViewer(
      pageService,
      pageGrantService,
      { pageId: req.query.pageId, path: null, user: req.user, basicOnly: true },
    );
    return !isIPageNotFoundInfo(meta);
  };

  // revisionId is dropped on share-link access (see design.md, list route).
  const toListInput = (req: Req): ListCommentsInput =>
    req.isSharedPage === true
      ? { pageId: req.query.pageId }
      : { pageId: req.query.pageId, revisionId: req.query.revisionId };

  return [
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    ...validator,
    apiV3FormValidator,
    certifySharedPage,
    loginRequired,
    async (req: Req, res: ApiV3Response) => {
      try {
        if (!(await canViewPage(req))) {
          return res.apiv3Err(notFoundOrForbidden(), 404);
        }

        const result = await listComments({ prisma }, toListInput(req));
        if (result.kind === 'revision-not-found') {
          return res.apiv3Err(notFoundOrForbidden(), 404);
        }

        const body: ListCommentsResponseBody = {
          comments: result.comments.map(toCommentListItem),
        };
        return res.apiv3(body);
      } catch (err) {
        logger.error('Failed to list comments', err);
        return res.apiv3Err(
          new ErrorV3('Failed to list comments', 'comment-list-failed'),
          500,
        );
      }
    },
  ];
};
