/**
 * POST /_api/v3/inline-comments — origin (anchored) inline comment creation.
 *
 * Middleware order (design.md's API Contract):
 *   accessTokenParser → loginRequired → express-validator → apiV3FormValidator
 *
 * `certifySharedPage` is intentionally NOT applied — this route must be
 * unreachable from a share-link context (requirement 6.1, design.md's
 * Security Considerations). `addActivity` is also intentionally NOT applied —
 * `InlineCommentService.create()` self-mints its own Activity id via
 * `prisma.activities.createByParameters` (see
 * `.kiro/specs/inline-comment/tasks.md`'s Implementation Notes and
 * `.claude/rules/activity-recording.md`); applying `addActivity` here would
 * register a failsafe finalizer that writes a spurious `ACTION_UNSETTLED` row
 * alongside the real `ACTION_INLINE_COMMENT_CREATE` row the service already wrote.
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
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { CreateInlineCommentRequestBody } from '../../interfaces/dto/create-inline-comment';
import { InlineCommentService } from '../service/inline-comment-service';

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
 * Factory function that wires the origin inline-comment creation route.
 *
 * @returns Express RequestHandler array to be spread into router.post().
 */
export const createInlineCommentRouteHandlersFactory = (
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

      const { pageId, anchorOriginRevisionId, comment, anchor } = req.body;

      // Viewer-filtered lookup, same mechanism get-page-info.ts / respond-with-page-markdown.ts
      // use. A uniform 404 on any failure (page missing OR forbidden) — see
      // apps/app/.claude/rules/page-write-action-403-404.md: this route's only
      // existence-check on `pageId` must not let an authenticated-but-unauthorized
      // caller distinguish "does not exist" from "exists but I cannot see it".
      const { meta } = await findPageAndMetaDataByViewer(
        pageService,
        pageGrantService,
        { pageId, path: null, user, basicOnly: true },
      );
      if (isIPageNotFoundInfo(meta)) {
        // Always respond 404 regardless of forbidden vs not-found — see
        // apps/app/.claude/rules/page-write-action-403-404.md
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
        const inlineComment = await service.create(
          { pageId, anchorOriginRevisionId, comment, anchor },
          user._id.toString(),
        );
        return res.apiv3({ inlineComment }, 201);
      } catch (err) {
        // The service's only precondition error here is an empty
        // `anchor.quote` (design.md's API Contract: "400（空クオート・不正な
        // pageId)"), so any Error it throws maps to 400.
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
