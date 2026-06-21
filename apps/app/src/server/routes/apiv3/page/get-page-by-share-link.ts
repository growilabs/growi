import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query } from 'express-validator';

import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { rejectLinkSharingDisabled } from '~/server/middlewares/reject-link-sharing-disabled';
import { configManager } from '~/server/service/config-manager';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { respondWithSinglePage } from './respond-with-single-page';

const logger = loggerFactory('growi:routes:apiv3:page:get-page-by-share-link');

type ReqQuery = {
  pageId: string;
  shareLinkId: string;
};

type Req = Request<
  Record<string, string>,
  ApiV3Response,
  undefined,
  ReqQuery
> & {
  isSharedPage?: boolean;
};

/**
 * @swagger
 *
 *    /page/shared:
 *      get:
 *        tags: [Page]
 *        summary: Get page by share link
 *        description: Get page data via a valid share link (public endpoint, no authentication required)
 *        parameters:
 *          - name: shareLinkId
 *            in: query
 *            required: true
 *            description: share link ID
 *            schema:
 *              $ref: '#/components/schemas/ObjectId'
 *          - name: pageId
 *            in: query
 *            required: true
 *            description: page ID
 *            schema:
 *              $ref: '#/components/schemas/ObjectId'
 *        responses:
 *          200:
 *            description: Successfully retrieved page via share link
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/GetPageResponse'
 *          403:
 *            description: Link sharing disabled, link expired, or forbidden page
 *          404:
 *            description: Share link not found or page not found
 *          400:
 *            description: Invalid or missing parameters
 */
export const getPageByShareLinkHandlerFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const { pageService, pageGrantService } = crowi;
  const certifySharedPage = require('../../../middlewares/certify-shared-page')(
    crowi,
  );

  const validator = [
    query('shareLinkId').isMongoId().withMessage('shareLinkId is required'),
    query('pageId').isMongoId().withMessage('pageId is required'),
  ];

  return [
    ...validator,
    apiV3FormValidator,
    rejectLinkSharingDisabled,
    certifySharedPage,
    async (req: Req, res: ApiV3Response) => {
      const { pageId } = req.query;

      if (!req.isSharedPage) {
        return res.apiv3Err(
          new ErrorV3(
            'Share link is not found or has expired',
            'share-link-invalid',
          ),
          404,
        );
      }

      try {
        const pageWithMeta = await findPageAndMetaDataByViewer(
          pageService,
          pageGrantService,
          {
            pageId,
            path: null,
            user: undefined,
            isSharedPage: true,
          },
        );

        const disableUserPages = configManager.getConfig(
          'security:disableUserPages',
        );
        return respondWithSinglePage(res, pageWithMeta, { disableUserPages });
      } catch (err) {
        logger.error('get-page-by-share-link-failed', err);
        return res.apiv3Err(err, 500);
      }
    },
  ];
};
