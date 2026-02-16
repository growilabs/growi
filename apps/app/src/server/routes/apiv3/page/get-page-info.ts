import type { IUserHasId } from '@growi/core';
import { isIPageNotFoundInfo, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query } from 'express-validator';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:page:get-page-info');

interface Req extends Request {
  user?: IUserHasId;
  isSharedPage?: boolean;
}

/**
 * @swagger
 *
 *    /page/info:
 *      get:
 *        tags: [Page]
 *        summary: /page/info
 *        description: Get summary informations for a page
 *        parameters:
 *          - name: pageId
 *            in: query
 *            required: true
 *            description: page id
 *            schema:
 *              $ref: '#/components/schemas/ObjectId'
 *          - name: shareLinkId
 *            in: query
 *            description: share link id for shared page access
 *            schema:
 *              $ref: '#/components/schemas/ObjectId'
 *        responses:
 *          200:
 *            description: Successfully retrieved current page info.
 *            content:
 *              application/json:
 *                schema:
 *                  $ref: '#/components/schemas/PageInfoExt'
 *          403:
 *            description: Page is forbidden.
 *          500:
 *            description: Internal server error.
 */
export const getPageInfoHandlerFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequired = loginRequiredFactory(crowi, true);
  const certifySharedPage = require('../../../middlewares/certify-shared-page')(
    crowi,
  );
  const { pageService, pageGrantService } = crowi;

  // define validators for req.query
  const validator = [
    query('pageId').isMongoId().withMessage('pageId is required'),
    query('shareLinkId').optional().isMongoId(),
  ];

  return [
    accessTokenParser([SCOPE.READ.FEATURES.PAGE]),
    certifySharedPage,
    loginRequired,
    ...validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { user, isSharedPage } = req;
      const { pageId } = req.query;

      try {
        const { meta } = await findPageAndMetaDataByViewer(
          pageService,
          pageGrantService,
          {
            pageId: pageId as string,
            path: null,
            user: user as any,
            isSharedPage,
          },
        );

        if (isIPageNotFoundInfo(meta)) {
          // Return error only when the page is forbidden
          if (meta.isForbidden) {
            return res.apiv3Err(
              new ErrorV3(
                'Page is forbidden',
                'page-is-forbidden',
                undefined,
                meta,
              ),
              403,
            );
          }
        }

        // Empty pages (isEmpty: true) should return page info for UI operations
        return res.apiv3(meta);
      } catch (err) {
        logger.error('get-page-info', err);
        return res.apiv3Err(err, 500);
      }
    },
  ];
};
