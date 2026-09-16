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
