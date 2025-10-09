import type {
  IPageInfoForListing, IPageInfo, IUserHasId,
} from '@growi/core';
import { getIdForRef, isIPageInfoForEntity } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, Router } from 'express';
import express from 'express';
import { query, oneOf } from 'express-validator';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { IPageForTreeItem } from '~/interfaces/page';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { configManager } from '~/server/service/config-manager';
import type { IPageGrantService } from '~/server/service/page-grant';
import { pageListingService } from '~/server/service/page-listing';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import type { PageDocument, PageModel } from '../../models/page';

import type { ApiV3Response } from './interfaces/apiv3-response';


const logger = loggerFactory('growi:routes:apiv3:page-tree');

/*
 * Types & Interfaces
 */
interface AuthorizedRequest extends Request {
  user?: IUserHasId,
}

/*
 * Validators
 */
const validator = {
  pagePathRequired: [
    query('path').isString().withMessage('path is required'),
  ],
  pageIdOrPathRequired: oneOf([
    query('id').isMongoId(),
    query('path').isString(),
  ], 'id or path is required'),
  pageIdsOrPathRequired: [
    // type check independent of existence check
    query('pageIds').isArray().optional(),
    query('path').isString().optional(),
    // existence check
    oneOf([
      query('pageIds').exists(),
      query('path').exists(),
    ], 'pageIds or path is required'),
  ],
  infoParams: [
    query('attachBookmarkCount').isBoolean().optional(),
    query('attachShortBody').isBoolean().optional(),
  ],
};

/*
 * Routes
 */
const routerFactory = (crowi: Crowi): Router => {
  const loginRequired = require('../../middlewares/login-required')(crowi, true);

  const router = express.Router();


  /**
   * @swagger
   *
   * /page-listing/root:
   *   get:
   *     tags: [PageListing]
   *     security:
   *       - bearer: []
   *       - accessTokenInQuery: []
   *     summary: /page-listing/root
   *     description: Get the root page
   *     responses:
   *       200:
   *         description: Success
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 rootPage:
   *                   $ref: '#/components/schemas/PageForTreeItem'
   */
  router.get('/root',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }), loginRequired, async(req: AuthorizedRequest, res: ApiV3Response) => {
      try {
        const rootPage: IPageForTreeItem = await pageListingService.findRootByViewer(req.user);
        return res.apiv3({ rootPage });
      }
      catch (err) {
        return res.apiv3Err(new ErrorV3('rootPage not found'));
      }
    });

  /**
   * @swagger
   *
   * /page-listing/children:
   *   get:
   *     tags: [PageListing]
   *     security:
   *       - bearer: []
   *       - accessTokenInQuery: []
   *     summary: /page-listing/children
   *     description: Get the children of a page
   *     parameters:
   *       - name: id
   *         in: query
   *         schema:
   *           type: string
   *       - name: path
   *         in: query
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Get the children of a page
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 children:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/PageForTreeItem'
   */
  /*
   * In most cases, using id should be prioritized
   */
  router.get('/children',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired, validator.pageIdOrPathRequired, apiV3FormValidator, async(req: AuthorizedRequest, res: ApiV3Response) => {
      const { id, path } = req.query;

      const hideRestrictedByOwner = await configManager.getConfig('security:list-policy:hideRestrictedByOwner');
      const hideRestrictedByGroup = await configManager.getConfig('security:list-policy:hideRestrictedByGroup');

      try {
        const pages = await pageListingService.findChildrenByParentPathOrIdAndViewer(
          (id || path) as string, req.user, !hideRestrictedByOwner, !hideRestrictedByGroup,
        );
        return res.apiv3({ children: pages });
      }
      catch (err) {
        logger.error('Error occurred while finding children.', err);
        return res.apiv3Err(new ErrorV3('Error occurred while finding children.'));
      }
    });

  /**
   * @swagger
   *
   * /page-listing/info:
   *   get:
   *     tags: [PageListing]
   *     security:
   *       - bearer: []
   *       - accessTokenInQuery: []
   *     summary: /page-listing/info
   *     description: Get summary information of pages
   *     parameters:
   *       - name: pageIds
   *         in: query
   *         description: Array of page IDs to retrieve information for (One of pageIds or path is required)
   *         schema:
   *           type: array
   *           items:
   *             type: string
   *       - name: path
   *         in: query
   *         description: Path of the page to retrieve information for (One of pageIds or path is required)
   *         schema:
   *           type: string
   *       - name: attachBookmarkCount
   *         in: query
   *         schema:
   *           type: boolean
   *       - name: attachShortBody
   *         in: query
   *         schema:
   *           type: boolean
   *     responses:
   *       200:
   *         description: Get the information of a page
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               additionalProperties:
   *                 $ref: '#/components/schemas/PageInfoAll'
   */
  router.get('/info',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    validator.pageIdsOrPathRequired, validator.infoParams, apiV3FormValidator, async(req: AuthorizedRequest, res: ApiV3Response) => {
      const {
        pageIds, path, attachBookmarkCount: attachBookmarkCountParam, attachShortBody: attachShortBodyParam,
      } = req.query;

      const attachBookmarkCount: boolean = attachBookmarkCountParam === 'true';
      const attachShortBody: boolean = attachShortBodyParam === 'true';

      const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>('Page');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Bookmark = mongoose.model<any, any>('Bookmark');
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const pageService = crowi.pageService;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const pageGrantService: IPageGrantService = crowi.pageGrantService!;

      try {
        const pages = pageIds != null
          ? await Page.findByIdsAndViewer(pageIds as string[], req.user, null, true)
          : await Page.findByPathAndViewer(path as string, req.user, null, false, true);

        const foundIds = pages.map(page => page._id);

        let shortBodiesMap;
        if (attachShortBody) {
          shortBodiesMap = await pageService.shortBodiesMapByPageIds(foundIds, req.user);
        }

        let bookmarkCountMap;
        if (attachBookmarkCount) {
          bookmarkCountMap = await Bookmark.getPageIdToCountMap(foundIds) as Record<string, number>;
        }

        const idToPageInfoMap: Record<string, IPageInfo | IPageInfoForListing> = {};

        const isGuestUser = req.user == null;

        const userRelatedGroups = await pageGrantService.getUserRelatedGroups(req.user);

        for (const page of pages) {
        // construct isIPageInfoForListing
          const basicPageInfo = pageService.constructBasicPageInfo(page, isGuestUser);

          // TODO: use pageService.getCreatorIdForCanDelete to get creatorId (https://redmine.weseek.co.jp/issues/140574)
          const canDeleteCompletely = pageService.canDeleteCompletely(
            page,
            page.creator == null ? null : getIdForRef(page.creator),
            req.user,
            false,
            userRelatedGroups,
          ); // use normal delete config

          const pageInfo = (!isIPageInfoForEntity(basicPageInfo))
            ? basicPageInfo
          // create IPageInfoForListing
            : {
              ...basicPageInfo,
              isAbleToDeleteCompletely: canDeleteCompletely,
              bookmarkCount: bookmarkCountMap != null ? bookmarkCountMap[page._id.toString()] : undefined,
              revisionShortBody: shortBodiesMap != null ? shortBodiesMap[page._id.toString()] : undefined,
            } as IPageInfoForListing;

          idToPageInfoMap[page._id.toString()] = pageInfo;
        }

        return res.apiv3(idToPageInfoMap);
      }
      catch (err) {
        logger.error('Error occurred while fetching page informations.', err);
        return res.apiv3Err(new ErrorV3('Error occurred while fetching page informations.'));
      }
    });

  return router;
};

export default routerFactory;
