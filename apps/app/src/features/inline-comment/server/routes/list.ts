/**
 * GET /_api/v3/inline-comments?pageId=... — page-scoped inline comment listing.
 *
 * Middleware order (design.md's API Contract):
 *   accessTokenParser → loginRequired → express-validator → apiV3FormValidator
 *
 * `certifySharedPage` is intentionally NOT applied — a share-link viewer must never
 * reach this route (requirement 6.1/6.2). GET routes are in scope for
 * `apps/app/.claude/rules/page-write-action-403-404.md` exactly like write routes
 * (any authenticated caller can hit a GET the same way they hit a POST/PUT), so the
 * `pageId` lookup below responds a uniform 404 on both "does not exist" and
 * "exists but forbidden".
 */

import assert from 'node:assert';
import type { IUser } from '@growi/core';
import { isIPageNotFoundInfo, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query } from 'express-validator';
import type { HydratedDocument } from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { InlineCommentService } from '../service/inline-comment-service';

const logger = loggerFactory('growi:routes:apiv3:inline-comments:list');

type Req = Request<
  Record<string, never>,
  ApiV3Response,
  unknown,
  { pageId?: string }
> & {
  user?: HydratedDocument<IUser>;
};

const validator = [
  query('pageId').isMongoId().withMessage('pageId must be a valid MongoId'),
];

/**
 * Factory function that wires the page-scoped inline-comment listing route.
 *
 * @returns Express RequestHandler array to be spread into router.get().
 */
export const listInlineCommentsRouteHandlersFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, false);
  const { pageService, pageGrantService } = crowi;

  return [
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
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

      // pageId is validated by express-validator as a MongoId string above.
      const pageId = req.query.pageId as string;

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
        const inlineComments = await service.listByPageId(pageId);
        return res.apiv3({ inlineComments });
      } catch (err) {
        logger.error('Failed to list inline comments', err);
        return res.apiv3Err(
          new ErrorV3(
            'Failed to list inline comments',
            'inline-comment-list-failed',
          ),
          500,
        );
      }
    },
  ];
};
