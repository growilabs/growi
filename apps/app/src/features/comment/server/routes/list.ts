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

  const canViewPage = async (req: Req): Promise<boolean> => {
    const { meta } = await findPageAndMetaDataByViewer(
      pageService,
      pageGrantService,
      { pageId: req.query.pageId, path: null, user: req.user, basicOnly: true },
    );
    return !isIPageNotFoundInfo(meta);
  };

  const toListInput = (req: Req): ListCommentsInput => ({
    pageId: req.query.pageId,
    revisionId: req.query.revisionId,
  });

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
