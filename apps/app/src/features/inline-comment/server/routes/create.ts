/**
 * POST /_api/v3/inline-comments — origin (anchored) inline comment creation.
 *
 * `certifySharedPage` is intentionally NOT applied — this route must be
 * unreachable from a share-link context. `addActivity` is also intentionally
 * NOT applied: `InlineCommentService.create()` self-mints its own Activity id
 * via `prisma.activities.createByParameters` (see
 * `.claude/rules/activity-recording.md`); applying `addActivity` here would
 * register a failsafe finalizer that writes a spurious `ACTION_UNSETTLED` row
 * alongside the real one the service already wrote.
 *
 * `excludeReadOnlyUserIfCommentNotAllowed` is the same middleware normal
 * comments use for `/comments.add`, and that `update.ts` already applies to
 * inline comment edits, placed right after `loginRequired` — this makes the
 * read-only-user restriction a server-side guarantee for creation too, not
 * only a client-side affordance a direct API call could bypass.
 */

import assert from 'node:assert';
import type { IUser } from '@growi/core';
import { isIPageNotFoundInfo, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body } from 'express-validator';
import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUserIfCommentNotAllowed } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import { isRevisionOfPage } from '~/server/util/is-revision-of-page';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { CreateInlineCommentRequestBody } from '../../interfaces/dto/create-inline-comment';
import { InlineCommentService } from '../service/inline-comment-service';
import { updatePageCommentCount } from '../update-page-comment-count';

const logger = loggerFactory('growi:routes:apiv3:inline-comments:create');

type Req = Request<
  Record<string, never>,
  ApiV3Response,
  CreateInlineCommentRequestBody
> & {
  user?: HydratedDocument<IUser>;
};

const validator = [
  body('pageId').isMongoId().withMessage('pageId must be a valid MongoId'),
  body('anchorOriginRevisionId')
    .isMongoId()
    .withMessage('anchorOriginRevisionId must be a valid MongoId'),
  body('comment').isString().withMessage('comment must be a string'),
  body('anchor').isObject().withMessage('anchor must be an object'),
  body('anchor.quote').isString().withMessage('anchor.quote must be a string'),
  body('anchor.prefix')
    .isString()
    .withMessage('anchor.prefix must be a string'),
  body('anchor.suffix')
    .isString()
    .withMessage('anchor.suffix must be a string'),
  body('anchor.approxOffset')
    .isInt({ min: 0 })
    .withMessage('anchor.approxOffset must be a non-negative integer'),
];

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      InlineCommentAnchor:
 *        description: >
 *          Where an inline comment points in the page body. Every value is measured
 *          against the page body as rendered in the browser, as plain text (the text
 *          a reader sees and selects, without markdown syntax), not against the
 *          markdown source. When the page is displayed, the passage is searched for
 *          again with `quote` and `approxOffset`: an exact match first, then the
 *          closest approximate match; if neither is found the comment is still shown,
 *          only without a highlight.
 *        type: object
 *        required:
 *          - quote
 *          - prefix
 *          - suffix
 *          - approxOffset
 *        properties:
 *          quote:
 *            type: string
 *            description: >
 *              The commented passage, exactly as it appears in the rendered text. Must
 *              not be empty. The server does not check that it occurs in the page.
 *          prefix:
 *            type: string
 *            description: >
 *              Text right before the passage. Stored, but not used to find the passage
 *              again. May be empty.
 *          suffix:
 *            type: string
 *            description: >
 *              Text right after the passage. Stored, but not used to find the passage
 *              again. May be empty.
 *          approxOffset:
 *            type: integer
 *            minimum: 0
 *            description: >
 *              Rough position of the start of the passage in the rendered text, in
 *              UTF-16 code units. Used only to choose among several occurrences of
 *              the same `quote`.
 *      InlineComment:
 *        description: >
 *          An origin inline comment: a comment anchored to a passage of the page body.
 *          Only origin comments carry an anchor and a resolved state; replies are
 *          `InlineCommentReply`.
 *        type: object
 *        required:
 *          - id
 *          - pageId
 *          - creatorId
 *          - creator
 *          - comment
 *          - anchorOriginRevisionId
 *          - anchor
 *          - resolvedById
 *          - resolvedAt
 *          - createdAt
 *          - updatedAt
 *        properties:
 *          id:
 *            type: string
 *          pageId:
 *            type: string
 *          creatorId:
 *            type: string
 *          creator:
 *            type: object
 *            nullable: true
 *            description: Always null in the responses of the write operations. GET /comments returns the creator.
 *          comment:
 *            type: string
 *            description: Comment body (markdown).
 *          anchorOriginRevisionId:
 *            type: string
 *            description: The revision of the page the anchor was taken from. Never changes after creation.
 *          anchor:
 *            $ref: '#/components/schemas/InlineCommentAnchor'
 *          resolvedById:
 *            type: string
 *            nullable: true
 *            description: The user who resolved the thread. Null while unresolved.
 *          resolvedAt:
 *            type: string
 *            format: date-time
 *            nullable: true
 *            description: When the thread was resolved. Null while unresolved.
 *          createdAt:
 *            type: string
 *            format: date-time
 *          updatedAt:
 *            type: string
 *            format: date-time
 *      InlineCommentReply:
 *        description: A reply to an origin inline comment. Has no anchor and no resolved state.
 *        type: object
 *        required:
 *          - id
 *          - pageId
 *          - creatorId
 *          - creator
 *          - comment
 *          - replyToId
 *          - createdAt
 *          - updatedAt
 *        properties:
 *          id:
 *            type: string
 *          pageId:
 *            type: string
 *          creatorId:
 *            type: string
 *          creator:
 *            type: object
 *            nullable: true
 *            description: Always null in the responses of the write operations. GET /comments returns the creator.
 *          comment:
 *            type: string
 *            description: Comment body (markdown).
 *          replyToId:
 *            type: string
 *            description: The origin inline comment this reply belongs to.
 *          createdAt:
 *            type: string
 *            format: date-time
 *          updatedAt:
 *            type: string
 *            format: date-time
 */

/**
 * @swagger
 *
 *    /inline-comments:
 *      post:
 *        tags: [Comments]
 *        summary: Create an inline comment
 *        description: >
 *          Creates an origin inline comment anchored to a passage of the page body. See
 *          `InlineCommentAnchor` for how the anchor is measured and how it is used when
 *          the page is displayed. Requires login, or an access token with the scope
 *          `write:features:page`, and permission to view the page. Not available
 *          through a share link. Read-only users are refused unless read-only users are
 *          allowed to comment.
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                required:
 *                  - pageId
 *                  - anchorOriginRevisionId
 *                  - comment
 *                  - anchor
 *                properties:
 *                  pageId:
 *                    type: string
 *                    description: ID of the page.
 *                  anchorOriginRevisionId:
 *                    type: string
 *                    description: >
 *                      ID of the page revision the anchor was taken from: the latest
 *                      revision when the passage was chosen.
 *                  comment:
 *                    type: string
 *                    description: Comment body (markdown).
 *                  anchor:
 *                    $ref: '#/components/schemas/InlineCommentAnchor'
 *        responses:
 *          201:
 *            description: The created inline comment.
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
 *              `validation_failed`); an empty `anchor.quote`, or an
 *              `anchorOriginRevisionId` of a revision of another page (code
 *              `inline-comment-create-failed`).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 *          403:
 *            description: Not authenticated, or the access token lacks the required scope.
 *          404:
 *            description: >
 *              The page does not exist, or the caller may not view it. The two cases
 *              are deliberately indistinguishable (code `notfound_or_forbidden`).
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/ErrorV3'
 */
export const createInlineCommentRouteHandlersFactory = (
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

      const { pageId, anchorOriginRevisionId, comment, anchor } = req.body;

      // Viewer-filtered lookup; uniform 404 on any failure, page missing or
      // forbidden — see apps/app/.claude/rules/page-write-action-403-404.md.
      const { meta } = await findPageAndMetaDataByViewer(
        pageService,
        pageGrantService,
        { pageId, path: null, user, basicOnly: true },
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

      // A revision of another page must not be linked; an unknown id is harmless anchor metadata.
      const anchorRevision = await prisma.revisions.findUnique({
        where: { id: anchorOriginRevisionId },
        select: { pageId: true },
      });
      if (anchorRevision != null && !isRevisionOfPage(anchorRevision, pageId)) {
        return res.apiv3Err(
          new ErrorV3(
            'The revision does not belong to this page.',
            'inline-comment-create-failed',
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
        const inlineComment = await service.create(
          { pageId, anchorOriginRevisionId, comment, anchor },
          user._id.toString(),
        );
        return res.apiv3({ inlineComment }, 201);
      } catch (err) {
        // The service's only precondition error here is an empty anchor.quote.
        logger.error('Failed to create inline comment', err);
        return res.apiv3Err(
          new ErrorV3(
            err instanceof Error
              ? err.message
              : 'Failed to create inline comment',
            'inline-comment-create-failed',
          ),
          400,
        );
      }
    },
  ];
};
