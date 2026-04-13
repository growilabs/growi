import { SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query } from 'express-validator';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { IPage, IPageModel } from '~/server/models/page';
import ShareLink from '~/server/models/share-link';
import { configManager } from '~/server/service/config-manager';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import { validateShareLink } from '~/server/service/share-link';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { respondWithSinglePage } from './respond-with-single-page';

const logger = loggerFactory('growi:routes:apiv3:page:get-page-by-share-link');

// Extend Request to include middleware-added properties
interface RequestWithShareLink extends Request {
  // No authentication properties expected for this public endpoint
}

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
  const Page = mongoose.model<IPage, IPageModel>('Page');

  // Define validators for req.query - both parameters required
  const validator = [
    query('shareLinkId').isMongoId().withMessage('shareLinkId is required'),
    query('pageId').isMongoId().withMessage('pageId is required'),
  ];

  return [
    ...validator,
    apiV3FormValidator,
    async (req: RequestWithShareLink, res: ApiV3Response) => {
      const { shareLinkId, pageId } = req.query;

      // Convert to strings (already validated as MongoId by express-validator)
      const shareLinkIdString =
        typeof shareLinkId === 'string' ? shareLinkId : String(shareLinkId);
      const pageIdString = typeof pageId === 'string' ? pageId : String(pageId);

      try {
        // First gate: Check if link sharing is enabled globally
        const disableLinkSharing = configManager.getConfig(
          'security:disableLinkSharing',
        );
        if (disableLinkSharing) {
          return res.apiv3Err(
            new ErrorV3('Link sharing is disabled', 'link-sharing-disabled'),
            403,
          );
        }

        // Validate ShareLink by ID and page ID in a single query
        const validationResult = await validateShareLink(
          ShareLink,
          shareLinkIdString,
          pageIdString,
        );

        if (validationResult.type === 'not-found') {
          return res.apiv3Err(
            new ErrorV3('Share link not found', 'share-link-not-found'),
            404,
          );
        }

        if (validationResult.type === 'expired') {
          return res.apiv3Err(
            new ErrorV3('Share link has expired', 'share-link-expired'),
            403,
          );
        }

        // ShareLink is valid - fetch page data
        // No user context for share link access - null user for public access
        const pageWithMeta = await findPageAndMetaDataByViewer(
          pageService,
          pageGrantService,
          {
            pageId: pageIdString,
            path: null,
            user: undefined,
            isSharedPage: true,
          },
        );

        // Send response with proper status codes and permission restrictions
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
