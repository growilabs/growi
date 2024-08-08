import type {
  IPageInfoForListing, IPageInfo, IPage,
} from '@growi/core';
import { getIdForRef, isIPageInfoForEntity } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, Router } from 'express';
import express from 'express';
import { query, oneOf } from 'express-validator';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { IPageGrantService } from '~/server/service/page-grant';
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
  user?: any
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
  const accessTokenParser = require('../../middlewares/access-token-parser')(crowi);
  const loginRequired = require('../../middlewares/login-required')(crowi, true);

  const router = express.Router();


  router.get('/root', accessTokenParser, loginRequired, async(req: AuthorizedRequest, res: ApiV3Response) => {
    const Page = mongoose.model<IPage, PageModel>('Page');

    let rootPage;
    try {
      rootPage = await Page.findByPathAndViewer('/', req.user, null, true);
    }
    catch (err) {
      return res.apiv3Err(new ErrorV3('rootPage not found'));
    }

    return res.apiv3({ rootPage });
  });

  // eslint-disable-next-line max-len
  router.get('/ancestors-children', accessTokenParser, loginRequired, ...validator.pagePathRequired, apiV3FormValidator, async(req: AuthorizedRequest, res: ApiV3Response): Promise<any> => {
    const { path } = req.query;

    const pageService = crowi.pageService;
    try {
      const ancestorsChildren = await pageService.findAncestorsChildrenByPathAndViewer(path as string, req.user);
      return res.apiv3({ ancestorsChildren });
    }
    catch (err) {
      logger.error('Failed to get ancestorsChildren.', err);
      return res.apiv3Err(new ErrorV3('Failed to get ancestorsChildren.'));
    }

  });

  /*
   * In most cases, using id should be prioritized
   */
  // eslint-disable-next-line max-len
  router.get('/children', accessTokenParser, loginRequired, validator.pageIdOrPathRequired, apiV3FormValidator, async(req: AuthorizedRequest, res: ApiV3Response) => {
    const { id, path } = req.query;

    const pageService = crowi.pageService;

    try {
      const pages = await pageService.findChildrenByParentPathOrIdAndViewer((id || path)as string, req.user);
      return res.apiv3({ children: pages });
    }
    catch (err) {
      logger.error('Error occurred while finding children.', err);
      return res.apiv3Err(new ErrorV3('Error occurred while finding children.'));
    }
  });

  // eslint-disable-next-line max-len
  router.get('/info', accessTokenParser, loginRequired, validator.pageIdsOrPathRequired, validator.infoParams, apiV3FormValidator, async(req: AuthorizedRequest, res: ApiV3Response) => {
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
