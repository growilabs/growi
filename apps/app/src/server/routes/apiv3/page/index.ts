import path from 'path';
import { type Readable } from 'stream';
import { pipeline } from 'stream/promises';

import type {
  IDataWithMeta, IPage, IPageInfoExt, IPageNotFoundInfo, IRevision,
} from '@growi/core';
import {
  getIdStringForRef,
  isIPageNotFoundInfo,
  AllSubscriptionStatusType, PageGrant, SCOPE, SubscriptionStatusType,
  getIdForRef,
} from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import { convertToNewAffiliationPath } from '@growi/core/dist/utils/page-path-utils';
import { normalizePath } from '@growi/core/dist/utils/path-utils';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import sanitize from 'sanitize-filename';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type { IPageGrantData } from '~/interfaces/page';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import type { PageDocument, PageModel } from '~/server/models/page';
import { Revision } from '~/server/models/revision';
import ShareLink from '~/server/models/share-link';
import Subscription from '~/server/models/subscription';
import { configManager } from '~/server/service/config-manager';
import { exportService } from '~/server/service/export';
import type { IPageGrantService } from '~/server/service/page-grant';
import { preNotifyService } from '~/server/service/pre-notify';
import { normalizeLatestRevisionIfBroken } from '~/server/service/revision/normalize-latest-revision-if-broken';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from '../interfaces/apiv3-response';

import { checkPageExistenceHandlersFactory } from './check-page-existence';
import { createPageHandlersFactory } from './create-page';
import { getPagePathsWithDescendantCountFactory } from './get-page-paths-with-descendant-count';
import { getYjsDataHandlerFactory } from './get-yjs-data';
import { publishPageHandlersFactory } from './publish-page';
import { syncLatestRevisionBodyToYjsDraftHandlerFactory } from './sync-latest-revision-body-to-yjs-draft';
import { unpublishPageHandlersFactory } from './unpublish-page';
import { updatePageHandlersFactory } from './update-page';


const logger = loggerFactory('growi:routes:apiv3:page'); // eslint-disable-line no-unused-vars

const express = require('express');
const { body, query, param } = require('express-validator');

const router = express.Router();


/**
 * @swagger
 *
 * components:
 *   schemas:
 *      LikeParams:
 *        description: LikeParams
 *        type: object
 *        properties:
 *          pageId:
 *            type: string
 *            description: page ID
 *            example: 5e07345972560e001761fa63
 *          bool:
 *            type: boolean
 *            description: boolean for like status
 *
 */
module.exports = (crowi: Crowi) => {
  const loginRequired = require('../../../middlewares/login-required')(crowi, true);
  const loginRequiredStrictly = require('../../../middlewares/login-required')(crowi);
  const certifySharedPage = require('../../../middlewares/certify-shared-page')(crowi);
  const addActivity = generateAddActivityMiddleware();

  const globalNotificationService = crowi.getGlobalNotificationService();
  const Page = mongoose.model<IPage, PageModel>('Page');
  const { pageService } = crowi;

  const activityEvent = crowi.event('activity');

  const validator = {
    getPage: [
      query('pageId').optional().isString(),
      query('path').optional().isString(),
      query('findAll').optional().isBoolean(),
      query('shareLinkId').optional().isMongoId(),
      query('includeEmpty').optional().isBoolean(),
    ],
    likes: [
      body('pageId').isString(),
      body('bool').isBoolean(),
    ],
    info: [
      query('pageId').isMongoId().withMessage('pageId is required'),
    ],
    getGrantData: [
      query('pageId').isMongoId().withMessage('pageId is required'),
    ],
    nonUserRelatedGroupsGranted: [
      query('path').isString(),
    ],
    applicableGrant: [
      query('pageId').isMongoId().withMessage('pageId is required'),
    ],
    updateGrant: [
      param('pageId').isMongoId().withMessage('pageId is required'),
      body('grant').isInt().withMessage('grant is required'),
      body('grantedGroups').optional().isArray().withMessage('grantedGroups must be an array'),
      body('grantedGroups.*.type').isString().withMessage('grantedGroups type is required'),
      body('grantedGroups.*.item').isMongoId().withMessage('grantedGroups item is required'),
    ],
    export: [
      query('format').isString().isIn(['md', 'pdf']),
      query('revisionId').optional().isMongoId(),
    ],
    archive: [
      body('rootPagePath').isString(),
      body('isCommentDownload').isBoolean(),
      body('isAttachmentFileDownload').isBoolean(),
      body('isSubordinatedPageDownload').isBoolean(),
      body('fileType').isString().isIn(['pdf', 'markdown']),
      body('hierarchyType').isString().isIn(['allSubordinatedPage', 'decideHierarchy']),
      body('hierarchyValue').isNumeric(),
    ],
    exist: [
      query('fromPath').isString(),
      query('toPath').isString(),
    ],
    subscribe: [
      body('pageId').isString(),
      body('status').isIn(AllSubscriptionStatusType),
    ],
    subscribeStatus: [
      query('pageId').isString(),
    ],
    contentWidth: [
      body('expandContentWidth').isBoolean(),
    ],
  };

  /**
   * @swagger
   *
   *    /page:
   *      get:
   *        tags: [Page]
   *        summary: Get page
   *        description: get page by pagePath or pageId
   *        parameters:
   *          - name: pageId
   *            in: query
   *            description: page id
   *            schema:
   *              $ref: '#/components/schemas/ObjectId'
   *          - name: path
   *            in: query
   *            description: page path
   *            schema:
   *              $ref: '#/components/schemas/PagePath'
   *        responses:
   *          200:
   *            description: Page data
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/Page'
   */
  router.get('/',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    certifySharedPage, loginRequired, validator.getPage, apiV3FormValidator, async(req, res) => {
      const { user, isSharedPage } = req;
      const {
        pageId, path, findAll, revisionId, shareLinkId, includeEmpty,
      } = req.query;

      const isValid = (shareLinkId != null && pageId != null && path == null) || (shareLinkId == null && (pageId != null || path != null));
      if (!isValid) {
        return res.apiv3Err(new Error('Either parameter of (pageId or path) or (pageId and shareLinkId) is required.'), 400);
      }

      let pageWithMeta: IDataWithMeta<HydratedDocument<PageDocument>, IPageInfoExt> | IDataWithMeta<null, IPageNotFoundInfo> = {
        data: null,
      };
      let pages;
      try {
        if (isSharedPage) {
          const shareLink = await ShareLink.findOne({ _id: { $eq: shareLinkId } });
          if (shareLink == null) {
            return res.apiv3Err('ShareLink is not found', 404);
          }
          pageWithMeta = await pageService.findPageAndMetaDataByViewer(getIdStringForRef(shareLink.relatedPage), path, user, true);
        }
        else if (!findAll) {
          pageWithMeta = await pageService.findPageAndMetaDataByViewer(pageId, path, user);
        }
        else {
          pages = await Page.findByPathAndViewer(path, user, null, false, includeEmpty);
        }
      }
      catch (err) {
        logger.error('get-page-failed', err);
        return res.apiv3Err(err, 500);
      }

      let { data: page } = pageWithMeta;
      const { meta } = pageWithMeta;

      // not found or forbidden
      if (page == null && (pages == null || pages.length === 0)) {
        if (isIPageNotFoundInfo(meta) && meta.isForbidden) {
          return res.apiv3Err(new ErrorV3('Page is forbidden', 'page-is-forbidden', undefined, meta), 403);
        }
        return res.apiv3Err(new ErrorV3('Page is not found', 'page-not-found', undefined, meta), 404);
      }

      if (page != null) {
        try {
          page.initLatestRevisionField(revisionId);

          // populate
          page = await page.populateDataToShowRevision();
        }
        catch (err) {
          logger.error('populate-page-failed', err);
          return res.apiv3Err(new ErrorV3('Failed to populate page', 'populate-page-failed', undefined, { err, meta }), 500);
        }
      }

      return res.apiv3({ page, pages, meta });
    });

  router.get('/page-paths-with-descendant-count', getPagePathsWithDescendantCountFactory(crowi));

  /**
   * @swagger
   *   /page/exist:
   *     get:
   *       tags: [Page]
   *       summary: Check if page exists
   *       description: Check if a page exists at the specified path
   *       parameters:
   *         - name: path
   *           in: query
   *           description: The path to check for existence
   *           required: true
   *           schema:
   *             type: string
   *       responses:
   *         200:
   *           description: Successfully checked page existence.
   *           content:
   *             application/json:
   *               schema:
   *                 type: object
   *                 properties:
   *                   isExist:
   *                     type: boolean
   */
  router.get('/exist', checkPageExistenceHandlersFactory(crowi));

  /**
   * @swagger
   *
   *    /page:
   *      post:
   *        tags: [Page]
   *        summary: Create page
   *        description: Create page
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  body:
   *                    type: string
   *                    description: Text of page
   *                  path:
   *                    $ref: '#/components/schemas/PagePath'
   *                  grant:
   *                    $ref: '#/components/schemas/PageGrant'
   *                  grantUserGroupIds:
   *                    type: array
   *                    items:
   *                      type: object
   *                      properties:
   *                        type:
   *                          type: string
   *                          description: Group type
   *                          example: 'UserGroup'
   *                        item:
   *                          type: string
   *                          description: UserGroup ID
   *                          example: '5ae5fccfc5577b0004dbd8ab'
   *                  pageTags:
   *                    type: array
   *                    items:
   *                      type: string
   *                required:
   *                  - body
   *                  - path
   *        responses:
   *          201:
   *            description: Succeeded to create page.
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    page:
   *                      $ref: '#/components/schemas/Page'
   *                    tags:
   *                      type: array
   *                      items:
   *                        $ref: '#/components/schemas/Tags'
   *                    revision:
   *                       $ref: '#/components/schemas/Revision'
   *          409:
   *            description: page path is already existed
   */
  router.post('/', createPageHandlersFactory(crowi));

  /**
   * @swagger
   *
   *    /page:
   *      put:
   *        tags: [Page]
   *        description: Update page
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  body:
   *                    $ref: '#/components/schemas/RevisionBody'
   *                  pageId:
   *                    $ref: '#/components/schemas/ObjectId'
   *                  revisionId:
   *                    $ref: '#/components/schemas/ObjectId'
   *                  grant:
   *                    $ref: '#/components/schemas/PageGrant'
   *                  userRelatedGrantUserGroupIds:
   *                    type: array
   *                    items:
   *                      type: object
   *                      properties:
   *                        type:
   *                          type: string
   *                          description: Group type
   *                          example: 'UserGroup'
   *                        item:
   *                          type: string
   *                          description: UserGroup ID
   *                          example: '5ae5fccfc5577b0004dbd8ab'
   *                  overwriteScopesOfDescendants:
   *                    type: boolean
   *                    description: Determine whether the scopes of descendants should be overwritten
   *                  isSlackEnabled:
   *                    type: boolean
   *                    description: Determine whether the page is enabled to be posted to Slack
   *                  slackChannels:
   *                    type: string
   *                    description: Slack channel IDs
   *                  origin:
   *                    type: string
   *                    description: Origin is "view" or "editor"
   *                  wip:
   *                    type: boolean
   *                    description: Determine whether the page is WIP
   *                required:
   *                  - body
   *                  - pageId
   *                  - revisionId
   *        responses:
   *          200:
   *            description: Succeeded to update page.
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    page:
   *                      $ref: '#/components/schemas/Page'
   *                    revision:
   *                      $ref: '#/components/schemas/Revision'
   *          403:
   *            $ref: '#/components/responses/Forbidden'
   *          500:
   *            $ref: '#/components/responses/InternalServerError'
   */
  router.put('/', updatePageHandlersFactory(crowi));

  /**
   * @swagger
   *
   *    /page/likes:
   *      put:
   *        tags: [Page]
   *        summary: Get page likes
   *        description: Update liked status
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/LikeParams'
   *        responses:
   *          200:
   *            description: Succeeded to update liked status.
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/Page'
   */
  router.put('/likes', accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }), loginRequiredStrictly, addActivity,
    validator.likes, apiV3FormValidator, async(req, res) => {
      const { pageId, bool: isLiked } = req.body;

      let page;
      try {
        page = await Page.findByIdAndViewer(pageId, req.user);
        if (page == null) {
          return res.apiv3Err(`Page '${pageId}' is not found or forbidden`);
        }

        if (isLiked) {
          page = await page.like(req.user);
        }
        else {
          page = await page.unlike(req.user);
        }
      }
      catch (err) {
        logger.error('update-like-failed', err);
        return res.apiv3Err(err, 500);
      }

      const result = { page, seenUser: page.seenUsers };

      const parameters = {
        targetModel: SupportedTargetModel.MODEL_PAGE,
        target: page,
        action: isLiked ? SupportedAction.ACTION_PAGE_LIKE : SupportedAction.ACTION_PAGE_UNLIKE,
      };

      activityEvent.emit('update', res.locals.activity._id, parameters, page, preNotifyService.generatePreNotify);


      res.apiv3({ result });

      if (isLiked) {
        try {
        // global notification
          await globalNotificationService.fire(GlobalNotificationSettingEvent.PAGE_LIKE, page, req.user);
        }
        catch (err) {
          logger.error('Like notification failed', err);
        }
      }
    });

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
   *        responses:
   *          200:
   *            description: Successfully retrieved current page info.
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/PageInfoAll'
   *          500:
   *            description: Internal server error.
   */
  router.get('/info', accessTokenParser([SCOPE.READ.FEATURES.PAGE]), certifySharedPage, loginRequired, validator.info, apiV3FormValidator, async(req, res) => {
    const { user, isSharedPage } = req;
    const { pageId } = req.query;

    try {
      const { meta } = await pageService.findPageAndMetaDataByViewer(pageId, null, user, isSharedPage);

      if (isIPageNotFoundInfo(meta)) {
        return res.apiv3Err(`Page '${pageId}' is not found or forbidden`);
      }

      return res.apiv3(meta);
    }
    catch (err) {
      logger.error('get-page-info', err);
      return res.apiv3Err(err, 500);
    }

  });

  /**
   * @swagger
   *
   *    /page/grant-data:
   *      get:
   *        tags: [Page]
   *        summary: Get page grant data
   *        description: Retrieve current page's grant data
   *        parameters:
   *          - name: pageId
   *            in: query
   *            description: page id
   *            schema:
   *              $ref: '#/components/schemas/ObjectId'
   *        responses:
   *          200:
   *            description: Successfully retrieved current grant data.
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    isGrantNormalized:
   *                      type: boolean
   *          400:
   *            description: Bad request. Page is unreachable or empty.
   *          500:
   *            description: Internal server error.
   */
  router.get('/grant-data', accessTokenParser([SCOPE.READ.FEATURES.PAGE]), loginRequiredStrictly,
    validator.getGrantData, apiV3FormValidator, async(req, res) => {
      const { pageId } = req.query;

      const Page = mongoose.model<IPage, PageModel>('Page');
      const pageGrantService = crowi.pageGrantService as IPageGrantService;

      const page = await Page.findByIdAndViewer(pageId, req.user, null, false);

      if (page == null) {
      // Empty page should not be related to grant API
        return res.apiv3Err(new ErrorV3('Page is unreachable or empty.', 'page_unreachable_or_empty'), 400);
      }

      const {
        path, grant, grantedUsers, grantedGroups,
      } = page;
      let isGrantNormalized = false;
      try {
        const grantedUsersId = grantedUsers.map(ref => getIdForRef(ref));
        isGrantNormalized = await pageGrantService.isGrantNormalized(req.user, path, grant, grantedUsersId, grantedGroups, false, false);
      }
      catch (err) {
        logger.error('Error occurred while processing isGrantNormalized.', err);
        return res.apiv3Err(err, 500);
      }

      const currentPageGroupGrantData = await pageGrantService.getPageGroupGrantData(page, req.user);
      const currentPageGrant: IPageGrantData = {
        grant: page.grant,
        groupGrantData: currentPageGroupGrantData,
      };

      // page doesn't have parent page
      if (page.parent == null) {
        const grantData = {
          isForbidden: false,
          currentPageGrant,
          parentPageGrant: null,
        };
        return res.apiv3({ isGrantNormalized, grantData });
      }

      const parentPage = await Page.findByIdAndViewer(getIdForRef(page.parent), req.user, null, false);

      // user isn't allowed to see parent's grant
      if (parentPage == null) {
        const grantData = {
          isForbidden: true,
          currentPageGrant,
          parentPageGrant: null,
        };
        return res.apiv3({ isGrantNormalized, grantData });
      }

      const parentPageGroupGrantData = await pageGrantService.getPageGroupGrantData(parentPage, req.user);
      const parentPageGrant: IPageGrantData = {
        grant,
        groupGrantData: parentPageGroupGrantData,
      };

      const grantData = {
        isForbidden: false,
        currentPageGrant,
        parentPageGrant,
      };

      return res.apiv3({ isGrantNormalized, grantData });
    });

  // Check if non user related groups are granted page access.
  // If specified page does not exist, check the closest ancestor.
  /**
   * @swagger
   *   /page/non-user-related-groups-granted:
   *     get:
   *       tags: [Page]
   *       security:
   *         - cookieAuth: []
   *       summary: Check if non-user related groups are granted page access
   *       description: Check if non-user related groups are granted access to a specific page or its closest ancestor
   *       parameters:
   *         - name: path
   *           in: query
   *           description: Path of the page
   *           required: true
   *           schema:
   *             type: string
   *       responses:
   *         200:
   *           description: Successfully checked non-user related groups access.
   *           content:
   *             application/json:
   *               schema:
   *                 type: object
   *                 properties:
   *                   isNonUserRelatedGroupsGranted:
   *                     type: boolean
   *         403:
   *           description: Forbidden. Cannot access page or ancestor.
   *         500:
   *           description: Internal server error.
   */
  router.get('/non-user-related-groups-granted', accessTokenParser([SCOPE.READ.FEATURES.PAGE]), loginRequiredStrictly,
    validator.nonUserRelatedGroupsGranted, apiV3FormValidator,
    async(req, res: ApiV3Response) => {
      const { user } = req;
      const path = normalizePath(req.query.path);
      const pageGrantService = crowi.pageGrantService as IPageGrantService;
      try {
        const page = await Page.findByPath(path, true) ?? await Page.findNonEmptyClosestAncestor(path);
        if (page == null) {
          // 'page' should always be non empty, since every page stems back to root page.
          // If it is empty, there is a problem with the server logic.
          return res.apiv3Err(new ErrorV3('No page on the page tree could be retrived.', 'page_could_not_be_retrieved'), 500);
        }

        const userRelatedGroups = await pageGrantService.getUserRelatedGroups(user);
        const isUserGrantedPageAccess = await pageGrantService.isUserGrantedPageAccess(page, user, userRelatedGroups, true);
        if (!isUserGrantedPageAccess) {
          return res.apiv3Err(new ErrorV3('Cannot access page or ancestor.', 'cannot_access_page'), 403);
        }

        if (page.grant !== PageGrant.GRANT_USER_GROUP) {
          return res.apiv3({ isNonUserRelatedGroupsGranted: false });
        }

        const nonUserRelatedGrantedGroups = await pageGrantService.getNonUserRelatedGrantedGroups(page, user);
        return res.apiv3({ isNonUserRelatedGroupsGranted: nonUserRelatedGrantedGroups.length > 0 });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    });
  /**
   * @swagger
   *   /page/applicable-grant:
   *     get:
   *       tags: [Page]
   *       security:
   *         - cookieAuth: []
   *       summary: Get applicable grant data
   *       description: Retrieve applicable grant data for a specific page
   *       parameters:
   *         - name: pageId
   *           in: query
   *           description: ID of the page
   *           required: true
   *           schema:
   *             type: string
   *       responses:
   *         200:
   *           description: Successfully retrieved applicable grant data.
   *           content:
   *             application/json:
   *               schema:
   *                 type: object
   *                 properties:
   *                   grant:
   *                     type: number
   *                   grantedUsers:
   *                     type: array
   *                     items:
   *                       type: string
   *                   grantedGroups:
   *                     type: array
   *                     items:
   *                       type: string
   *         400:
   *           description: Bad request. Page is unreachable or empty.
   *         500:
   *           description: Internal server error.
   */
  router.get('/applicable-grant', accessTokenParser([SCOPE.READ.FEATURES.PAGE]), loginRequiredStrictly, validator.applicableGrant, apiV3FormValidator,
    async(req, res) => {
      const { pageId } = req.query;

      const Page = mongoose.model<IPage, PageModel>('Page');
      const page = await Page.findByIdAndViewer(pageId, req.user, null);

      if (page == null) {
      // Empty page should not be related to grant API
        return res.apiv3Err(new ErrorV3('Page is unreachable or empty.', 'page_unreachable_or_empty'), 400);
      }

      let data;
      try {
        data = await crowi.pageGrantService.calcApplicableGrantData(page, req.user);
      }
      catch (err) {
        logger.error('Error occurred while processing calcApplicableGrantData.', err);
        return res.apiv3Err(err, 500);
      }

      return res.apiv3(data);
    });

  /**
   * @swagger
   *   /{pageId}/grant:
   *     put:
   *       tags: [Page]
   *       security:
   *         - cookieAuth: []
   *       summary: Update page grant
   *       description: Update the grant of a specific page
   *       parameters:
   *         - name: pageId
   *           in: path
   *           description: ID of the page
   *           required: true
   *           schema:
   *             type: string
   *       requestBody:
   *         content:
   *           application/json:
   *             schema:
   *               properties:
   *                 grant:
   *                   type: number
   *                   description: Grant level
   *                 userRelatedGrantedGroups:
   *                   type: array
   *                   items:
   *                     type: string
   *                   description: Array of user-related granted group IDs
   *       responses:
   *         200:
   *           description: Successfully updated page grant.
   *           content:
   *             application/json:
   *               schema:
   *                 $ref: '#/components/schemas/Page'
   */
  router.put('/:pageId/grant', accessTokenParser([SCOPE.WRITE.FEATURES.PAGE]), loginRequiredStrictly, excludeReadOnlyUser,
    validator.updateGrant, apiV3FormValidator,
    async(req, res) => {
      const { pageId } = req.params;
      const { grant, userRelatedGrantedGroups } = req.body;

      const Page = mongoose.model<IPage, PageModel>('Page');

      const page = await Page.findByIdAndViewer(pageId, req.user, null, false);

      if (page == null) {
      // Empty page should not be related to grant API
        return res.apiv3Err(new ErrorV3('Page is unreachable or empty.', 'page_unreachable_or_empty'), 400);
      }

      let data;
      try {
        const grantData = { grant, userRelatedGrantedGroups };
        data = await crowi.pageService.updateGrant(page, req.user, grantData);
      }
      catch (err) {
        logger.error('Error occurred while processing calcApplicableGrantData.', err);
        return res.apiv3Err(err, 500);
      }

      return res.apiv3(data);
    });

  /**
  * @swagger
  *
  *    /page/export/{pageId}:
  *      get:
  *        tags: [Page]
  *        security:
  *          - cookieAuth: []
  *        description: return page's markdown
  *        parameters:
  *          - name: pageId
  *            in: path
  *            description: ID of the page
  *            required: true
  *            schema:
  *              type: string
  *        responses:
  *          200:
  *            description: Return page's markdown
  */
  router.get('/export/:pageId', accessTokenParser([SCOPE.READ.FEATURES.PAGE]), loginRequiredStrictly, validator.export, async(req, res) => {
    const pageId: string = req.params.pageId;
    const format: 'md' | 'pdf' = req.query.format ?? 'md';
    const revisionId: string | undefined = req.query.revisionId;

    let revision: HydratedDocument<IRevision> | null;
    let pagePath;

    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>('Page');

    let page: HydratedDocument<PageDocument> | null;

    try {
      page = await Page.findByIdAndViewer(pageId, req.user);

      if (page == null) {
        const isPageExist = await Page.count({ _id: pageId }) > 0;
        if (isPageExist) {
          // This page exists but req.user has not read permission
          return res.apiv3Err(new ErrorV3(`Haven't the right to see the page ${pageId}.`), 403);
        }
        return res.apiv3Err(new ErrorV3(`Page ${pageId} is not exist.`), 404);
      }
    }
    catch (err) {
      logger.error('Failed to get page data', err);
      return res.apiv3Err(err, 500);
    }

    // Normalize the latest revision which was borken by the migration script '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549.js'
    try {
      await normalizeLatestRevisionIfBroken(pageId);
    }
    catch (err) {
      logger.error('Error occurred in normalizing the latest revision');
    }

    try {
      const targetId = revisionId ?? (page.revision != null ? getIdForRef(page.revision) : null);
      if (targetId == null) {
        throw new Error('revisionId is not specified');
      }

      const revisionIdForFind = new mongoose.Types.ObjectId(targetId);
      revision = await Revision.findById(revisionIdForFind);
      if (revision == null) {
        throw new Error('Revision is not found');
      }

      pagePath = page.path;

      // Error if pageId and revison's pageIds do not match
      if (page._id.toString() !== revision.pageId.toString()) {
        return res.apiv3Err(new ErrorV3("Haven't the right to see the page."), 403);
      }
    }
    catch (err) {
      logger.error('Failed to get revision data', err);
      return res.apiv3Err(err, 500);
    }

    // replace forbidden characters to '_'
    // refer to https://kb.acronis.com/node/56475?ckattempt=1
    let fileName = sanitize(path.basename(pagePath), { replacement: '_' });


    // replace root page name to '_top'
    if (fileName === '') {
      fileName = '_top';
    }

    let stream: Readable;

    try {
      if (exportService == null) {
        throw new Error('exportService is not initialized');
      }
      stream = exportService.getReadStreamFromRevision(revision, format);
    }
    catch (err) {
      logger.error('Failed to create readStream', err);
      return res.apiv3Err(err, 500);
    }

    res.set({
      'Content-Disposition': `attachment;filename*=UTF-8''${encodeURIComponent(fileName)}.${format}`,
    });

    const parameters = {
      ip:  req.ip,
      endpoint: req.originalUrl,
      action: SupportedAction.ACTION_PAGE_EXPORT,
      user: req.user?._id,
      snapshot: {
        username: req.user?.username,
      },
    };
    await crowi.activityService.createActivity(parameters);

    await pipeline(stream, res);
  });

  /**
   * @swagger
   *
   *    /page/exist-paths:
   *      get:
   *        tags: [Page]
   *        security:
   *          - cookieAuth: []
   *        summary: Get already exist paths
   *        description: Get already exist paths
   *        parameters:
   *          - name: fromPath
   *            in: query
   *            description: old parent path
   *            schema:
   *              type: string
   *          - name: toPath
   *            in: query
   *            description: new parent path
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Succeeded to retrieve pages.
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    existPaths:
   *                      type: object
   *                      description: Paths are already exist in DB
   *          500:
   *            description: Internal server error.
   */
  router.get('/exist-paths', accessTokenParser([SCOPE.READ.FEATURES.PAGE]), loginRequired, validator.exist, apiV3FormValidator, async(req, res) => {
    const { fromPath, toPath } = req.query;

    try {
      const fromPage = await Page.findByPath(fromPath, true);
      if (fromPage == null) {
        return res.apiv3Err(new ErrorV3('fromPage is not exist', 'from-page-is-not-exist'), 400);
      }

      const fromPageDescendants = await Page.findManageableListWithDescendants(fromPage, req.user, {}, true);

      const toPathDescendantsArray = fromPageDescendants.map((subordinatedPage) => {
        return convertToNewAffiliationPath(fromPath, toPath, subordinatedPage.path);
      });

      const existPages = await Page.findListByPathsArray(toPathDescendantsArray);
      const existPaths = existPages.map(page => page.path);

      return res.apiv3({ existPaths });

    }
    catch (err) {
      logger.error('Failed to get exist path', err);
      return res.apiv3Err(err, 500);
    }

  });

  /**
   * @swagger
   *
   *    /page/subscribe:
   *      put:
   *        tags: [Page]
   *        summary: Update subscription status
   *        description: Update subscription status
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  pageId:
   *                    $ref: '#/components/schemas/ObjectId'
   *        responses:
   *          200:
   *            description: Succeeded to update subscription status.
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/Page'
   *          500:
   *            description: Internal server error.
   */
  router.put('/subscribe', accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }), loginRequiredStrictly, addActivity,
    validator.subscribe, apiV3FormValidator,
    async(req, res) => {
      const { pageId, status } = req.body;
      const userId = req.user._id;

      try {
        const subscription = await Subscription.subscribeByPageId(userId, pageId, status);

        const parameters = {};
        if (SubscriptionStatusType.SUBSCRIBE === status) {
          Object.assign(parameters, { action: SupportedAction.ACTION_PAGE_SUBSCRIBE });
        }
        else if (SubscriptionStatusType.UNSUBSCRIBE === status) {
          Object.assign(parameters, { action: SupportedAction.ACTION_PAGE_UNSUBSCRIBE });
        }
        if ('action' in parameters) {
          activityEvent.emit('update', res.locals.activity._id, parameters);
        }

        return res.apiv3({ subscription });
      }
      catch (err) {
        logger.error('Failed to update subscribe status', err);
        return res.apiv3Err(err, 500);
      }
    });


  /**
   * @swagger
   *
   *   /{pageId}/content-width:
   *     put:
   *       tags: [Page]
   *       summary: Update content width
   *       description: Update the content width setting for a specific page
   *       parameters:
   *         - name: pageId
   *           in: path
   *           description: ID of the page
   *           required: true
   *           schema:
   *             type: string
   *       requestBody:
   *         content:
   *           application/json:
   *             schema:
   *               properties:
   *                 expandContentWidth:
   *                   type: boolean
   *                   description: Whether to expand the content width
   *       responses:
   *         200:
   *           description: Successfully updated content width.
   *           content:
   *             application/json:
   *               schema:
   *                 properties:
   *                   page:
   *                     $ref: '#/components/schemas/Page'
   */
  router.put('/:pageId/content-width', accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }), loginRequiredStrictly, excludeReadOnlyUser,
    validator.contentWidth, apiV3FormValidator, async(req, res) => {
      const { pageId } = req.params;
      const { expandContentWidth } = req.body;

      const isContainerFluidBySystem = configManager.getConfig('customize:isContainerFluid');

      try {
        const updateQuery = expandContentWidth === isContainerFluidBySystem
          ? { $unset: { expandContentWidth } } // remove if the specified value is the same to the system's one
          : { $set: { expandContentWidth } };

        const page = await Page.updateOne({ _id: pageId }, updateQuery);
        return res.apiv3({ page });
      }
      catch (err) {
        logger.error('update-content-width-failed', err);
        return res.apiv3Err(err, 500);
      }
    });

  /**
   * @swagger
   *   /page/{pageId}/publish:
   *     put:
   *       tags: [Page]
   *       summary: Publish page
   *       description: Publish a specific page
   *       parameters:
   *         - name: pageId
   *           in: path
   *           description: ID of the page
   *           required: true
   *           schema:
   *             type: string
   *       responses:
   *         200:
   *           description: Successfully published the page.
   *           content:
   *             application/json:
   *               schema:
   *                 $ref: '#/components/schemas/Page'
   */
  router.put('/:pageId/publish', publishPageHandlersFactory(crowi));

  /**
   * @swagger
   *   /page/{pageId}/unpublish:
   *     put:
   *       tags: [Page]
   *       summary: Unpublish page
   *       description: Unpublish a specific page
   *       parameters:
   *         - name: pageId
   *           in: path
   *           description: ID of the page
   *           required: true
   *           schema:
   *             type: string
   *       responses:
   *         200:
   *           description: Successfully unpublished the page.
   *           content:
   *             application/json:
   *               schema:
   *                 $ref: '#/components/schemas/Page'
   */
  router.put('/:pageId/unpublish', unpublishPageHandlersFactory(crowi));

  /**
   * @swagger
   *   /{pageId}/yjs-data:
   *     get:
   *       tags: [Page]
   *       summary: Get Yjs data
   *       description: Retrieve Yjs data for a specific page
   *       parameters:
   *         - name: pageId
   *           in: path
   *           description: ID of the page
   *           required: true
   *           schema:
   *             type: string
   *       responses:
   *         200:
   *           description: Successfully retrieved Yjs data.
   *           content:
   *             application/json:
   *               schema:
   *                 type: object
   *                 properties:
   *                   yjsData:
   *                     type: object
   *                     description: Yjs data
   *                     properties:
   *                       hasYdocsNewerThanLatestRevision:
   *                         type: boolean
   *                         description: Whether Yjs documents are newer than the latest revision
   *                       awarenessStateSize:
   *                         type: number
   *                         description: Size of the awareness state
   */
  router.get('/:pageId/yjs-data', getYjsDataHandlerFactory(crowi));

  /**
   * @swagger
   *   /{pageId}/sync-latest-revision-body-to-yjs-draft:
   *     put:
   *       tags: [Page]
   *       summary: Sync latest revision body to Yjs draft
   *       description: Sync the latest revision body to the Yjs draft for a specific page
   *       parameters:
   *         - name: pageId
   *           in: path
   *           description: ID of the page
   *           required: true
   *           schema:
   *             type: string
   *       requestBody:
   *         content:
   *           application/json:
   *             schema:
   *               properties:
   *                 editingMarkdownLength:
   *                   type: integer
   *                   description: Length of the editing markdown
   *       responses:
   *         200:
   *           description: Successfully synced the latest revision body to Yjs draft.
   *           content:
   *             application/json:
   *               schema:
   *                 type: object
   *                 properties:
   *                   synced:
   *                     type: boolean
   *                     description: Whether the latest revision body is synced to the Yjs draft
   *                   isYjsDataBroken:
   *                     type: boolean
   *                     description: Whether Yjs data is broken
   */
  router.put('/:pageId/sync-latest-revision-body-to-yjs-draft', syncLatestRevisionBodyToYjsDraftHandlerFactory(crowi));

  return router;
};
