
import { PageGrant } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import { isCreatablePage, isTrashPage, isUserPage } from '@growi/core/dist/utils/page-path-utils';
import { normalizePath, addHeadingSlash } from '@growi/core/dist/utils/path-utils';
import express from 'express';
import { body, query } from 'express-validator';

import { SupportedTargetModel, SupportedAction } from '~/interfaces/activity';
import { subscribeRuleNames } from '~/interfaces/in-app-notification';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import PageTagRelation from '~/server/models/page-tag-relation';
import { configManager } from '~/server/service/config-manager';
import { preNotifyService } from '~/server/service/pre-notify';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../../middlewares/add-activity';
import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '../../../middlewares/exclude-read-only-user';
import { serializePageSecurely } from '../../../models/serializers/page-serializer';
import { isV5ConversionError } from '../../../models/vo/v5-conversion-error';


const logger = loggerFactory('growi:routes:apiv3:pages'); // eslint-disable-line no-unused-vars
const router = express.Router();

const LIMIT_FOR_LIST = 10;
const LIMIT_FOR_MULTIPLE_PAGE_OP = 20;

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequired = require('../../../middlewares/login-required')(crowi, true);
  const loginRequiredStrictly = require('../../../middlewares/login-required')(crowi);
  const adminRequired = require('../../../middlewares/admin-required')(crowi);

  const Page = crowi.model('Page');
  const User = crowi.model('User');

  const activityEvent = crowi.event('activity');

  const globalNotificationService = crowi.getGlobalNotificationService();

  const addActivity = generateAddActivityMiddleware(crowi);

  const validator = {
    recent: [
      query('limit').optional().isInt().withMessage('limit must be integer'),
      query('offset').optional().isInt().withMessage('offset must be integer'),
      query('includeWipPage').optional().isBoolean().withMessage('includeWipPage must be boolean'),
    ],
    renamePage: [
      body('pageId').isMongoId().withMessage('pageId is required'),
      body('newPagePath').isLength({ min: 1 }).withMessage('newPagePath is required'),
      body('isRecursively').if(value => value != null).isBoolean().withMessage('isRecursively must be boolean'),
      body('isRenameRedirect').if(value => value != null).isBoolean().withMessage('isRenameRedirect must be boolean'),
      body('updateMetadata').if(value => value != null).isBoolean().withMessage('updateMetadata must be boolean'),
    ],
    resumeRenamePage: [
      body('pageId').isMongoId().withMessage('pageId is required'),
    ],
    list: [
      query('path').optional(),
      query('page').optional().isInt().withMessage('page must be integer'),
      query('limit').optional().isInt().withMessage('limit must be integer'),
    ],
    duplicatePage: [
      body('pageId').isMongoId().withMessage('pageId is required'),
      body('pageNameInput').trim().isLength({ min: 1 }).withMessage('pageNameInput is required'),
      body('isRecursively').if(value => value != null).isBoolean().withMessage('isRecursively must be boolean'),
    ],
    deletePages: [
      body('pageIdToRevisionIdMap')
        .exists()
        .withMessage('The body property "pageIdToRevisionIdMap" must be an json map with pageId as key and revisionId as value.'),
      body('isCompletely')
        .custom(v => v === 'true' || v === true || v == null)
        .withMessage('The body property "isCompletely" must be "true" or true. (Omit param for false)'),
      body('isRecursively')
        .custom(v => v === 'true' || v === true || v == null)
        .withMessage('The body property "isRecursively" must be "true" or true. (Omit param for false)'),
      body('isAnyoneWithTheLink')
        .custom(v => v === 'true' || v === true || v == null)
        .withMessage('The body property "isAnyoneWithTheLink" must be "true" or true. (Omit param for false)'),
    ],
    legacyPagesMigration: [
      body('convertPath').optional().isString().withMessage('convertPath must be a string'),
      body('pageIds').optional().isArray().withMessage('pageIds must be an array'),
      body('isRecursively')
        .optional()
        .custom(v => v === 'true' || v === true || v == null)
        .withMessage('The body property "isRecursively" must be "true" or true. (Omit param for false)'),
    ],
    convertPagesByPath: [
      body('convertPath').optional().isString().withMessage('convertPath must be a string'),
    ],
  };

  /**
   * @swagger
   *
   *    /pages/recent:
   *      get:
   *        tags: [Pages]
   *        description: Get recently updated pages
   *        parameters:
   *          - name: limit
   *            in: query
   *            description: Limit of acquisitions
   *            schema:
   *              type: number
   *            example: 10
   *          - name: offset
   *            in: query
   *            description: Offset of acquisitions
   *            schema:
   *              type: number
   *            example: 0
   *          - name: includeWipPage
   *            in: query
   *            description: Whether to include WIP pages
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Return pages recently updated
   */
  router.get('/recent', accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired, validator.recent, apiV3FormValidator, async(req, res) => {
      const limit = parseInt(req.query.limit) || 20;
      const offset = parseInt(req.query.offset) || 0;
      const includeWipPage = req.query.includeWipPage === 'true'; // Need validation using express-validator

      const hideRestrictedByOwner = configManager.getConfig('security:list-policy:hideRestrictedByOwner');
      const hideRestrictedByGroup = configManager.getConfig('security:list-policy:hideRestrictedByGroup');

      /**
    * @type {import('~/server/models/page').FindRecentUpdatedPagesOption}
    */
      const queryOptions = {
        offset,
        limit,
        includeWipPage,
        includeTrashed: false,
        isRegExpEscapedFromPath: true,
        sort: 'updatedAt',
        desc: -1,
        hideRestrictedByOwner,
        hideRestrictedByGroup,
      };

      try {
        const result = await Page.findRecentUpdatedPages('/', req.user, queryOptions);
        if (result.pages.length > limit) {
          result.pages.pop();
        }

        result.pages.forEach((page) => {
          if (page.lastUpdateUser != null && page.lastUpdateUser instanceof User) {
            page.lastUpdateUser = serializeUserSecurely(page.lastUpdateUser);
          }
        });

        const ids = result.pages.map((page) => { return page._id });
        const relations = await PageTagRelation.find({ relatedPage: { $in: ids } }).populate('relatedTag');

        // { pageId: [{ tag }, ...] }
        const relationsMap = new Map();
        // increment relationsMap
        relations.forEach((relation) => {
          const pageId = relation.relatedPage.toString();
          if (!relationsMap.has(pageId)) {
            relationsMap.set(pageId, []);
          }
          if (relation.relatedTag != null) {
            relationsMap.get(pageId).push(relation.relatedTag);
          }
        });
        // add tags to each page
        result.pages.forEach((page) => {
          const pageId = page._id.toString();
          page.tags = relationsMap.has(pageId) ? relationsMap.get(pageId) : [];
        });

        return res.apiv3(result);
      }
      catch (err) {
        logger.error('Failed to get recent pages', err);
        return res.apiv3Err(new ErrorV3('Failed to get recent pages', 'unknown'), 500);
      }
    });

  /**
   * @swagger
   *
   *
   *    /pages/rename:
   *      put:
   *        tags: [Pages]
   *        description: Rename page
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  pageId:
   *                    $ref: '#/components/schemas/ObjectId'
   *                  path:
   *                    $ref: '#/components/schemas/PagePath'
   *                  newPagePath:
   *                    type: string
   *                    description: new path
   *                    example: /user/alice/new_test
   *                  isRenameRedirect:
   *                    type: boolean
   *                    description: whether redirect page
   *                  updateMetadata:
   *                    type: boolean
   *                    description: whether update meta data
   *                  isRecursively:
   *                    type: boolean
   *                    description: whether rename page with descendants
   *                required:
   *                  - pageId
   *                  - revisionId
   *        responses:
   *          200:
   *            description: Succeeded to rename page.
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    page:
   *                      $ref: '#/components/schemas/Page'
   *          401:
   *            description: page id is invalid
   *          409:
   *            description: page path is already existed
   */
  router.put(
    '/rename',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    validator.renamePage,
    apiV3FormValidator,
    async(req, res) => {
      const { pageId, revisionId } = req.body;

      let newPagePath = normalizePath(req.body.newPagePath);

      const options = {
        isRecursively: req.body.isRecursively,
        createRedirectPage: req.body.isRenameRedirect,
        updateMetadata: req.body.updateMetadata,
      };

      const activityParameters = {
        ip: req.ip,
        endpoint: req.originalUrl,
      };

      if (!isCreatablePage(newPagePath)) {
        return res.apiv3Err(new ErrorV3(`Could not use the path '${newPagePath}'`, 'invalid_path'), 409);
      }

      if (isUserPage(newPagePath)) {
        const isExistUser = await User.isExistUserByUserPagePath(newPagePath);
        if (!isExistUser) {
          return res.apiv3Err("Unable to rename a page under a non-existent user's user page");
        }
      }

      // check whether path starts slash
      newPagePath = addHeadingSlash(newPagePath);

      const isExist = await Page.exists({ path: newPagePath, isEmpty: false });
      if (isExist) {
      // if page found, cannot rename to that path
        return res.apiv3Err(new ErrorV3(`${newPagePath} already exists`, 'already_exists'), 409);
      }

      let page;
      let renamedPage;

      try {
        page = await Page.findByIdAndViewer(pageId, req.user, null, true);
        options.isRecursively = page.descendantCount > 0;

        if (page == null) {
          return res.apiv3Err(new ErrorV3(`Page '${pageId}' is not found or forbidden`, 'notfound_or_forbidden'), 401);
        }

        // empty page does not require revisionId validation
        if (!page.isEmpty && revisionId == null) {
          return res.apiv3Err(new ErrorV3('revisionId must be a mongoId', 'invalid_body'), 400);
        }

        if (!page.isEmpty && !page.isUpdatable(revisionId)) {
          return res.apiv3Err(new ErrorV3('Someone could update this page, so couldn\'t delete.', 'notfound_or_forbidden'), 409);
        }
        renamedPage = await crowi.pageService.renamePage(page, newPagePath, req.user, options, activityParameters);

        // Respond before sending notification
        const result = { page: serializePageSecurely(renamedPage ?? page) };
        res.apiv3(result);
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to update page.', 'unknown'), 500);
      }

      try {
      // global notification
        await globalNotificationService.fire(GlobalNotificationSettingEvent.PAGE_MOVE, renamedPage, req.user, {
          oldPath: page.path,
        });
      }
      catch (err) {
        logger.error('Move notification failed', err);
      }
    },
  );

  /**
    * @swagger
    *    /pages/resume-rename:
    *      post:
    *        tags: [Pages]
    *        description: Resume rename page operation
    *        requestBody:
    *          content:
    *            application/json:
    *              schema:
    *                properties:
    *                  pageId:
    *                    $ref: '#/components/schemas/ObjectId'
    *                required:
    *                  - pageId
    *        responses:
    *          200:
    *            description: Succeeded to resume rename page operation.
    *            content:
    *              application/json:
    *                schema:
    *                  type: object
    */
  router.post(
    '/resume-rename',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    validator.resumeRenamePage,
    apiV3FormValidator,
    async(req, res) => {

      const { pageId } = req.body;
      const { user } = req;

      // The user has permission to resume rename operation if page is returned.
      const page = await Page.findByIdAndViewer(pageId, user, null, true);
      if (page == null) {
        const msg = 'The operation is forbidden for this user';
        const code = 'forbidden-user';
        return res.apiv3Err(new ErrorV3(msg, code), 403);
      }

      const pageOp = await crowi.pageOperationService.getRenameSubOperationByPageId(page._id);
      if (pageOp == null) {
        const msg = 'PageOperation document for Rename Sub operation not found.';
        const code = 'document_not_found';
        return res.apiv3Err(new ErrorV3(msg, code), 404);
      }

      try {
        await crowi.pageService.resumeRenameSubOperation(page, pageOp);
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
      return res.apiv3();
    },
  );

  /**
   * @swagger
   *
   *    /pages/empty-trash:
   *      delete:
   *        tags: [Pages]
   *        description: empty trash
   *        responses:
   *          200:
   *            description: Succeeded to remove all trash pages
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    deletablePages:
   *                      type: array
   *                      items:
   *                        $ref: '#/components/schemas/Page'
   */
  router.delete(
    '/empty-trash',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    excludeReadOnlyUser,
    addActivity,
    apiV3FormValidator,
    async(req, res) => {
      const options = {};

      const pagesInTrash = await crowi.pageService.findAllTrashPages(req.user);

      const deletablePages = crowi.pageService.filterPagesByCanDeleteCompletely(pagesInTrash, req.user, true);

      if (deletablePages.length === 0) {
        const msg = 'No pages can be deleted.';
        return res.apiv3Err(new ErrorV3(msg), 500);
      }

      const parameters = { action: SupportedAction.ACTION_PAGE_EMPTY_TRASH };

      // when some pages are not deletable
      if (deletablePages.length < pagesInTrash.length) {
        try {
          const options = { isCompletely: true, isRecursively: true };
          await crowi.pageService.deleteMultiplePages(deletablePages, req.user, options);

          activityEvent.emit('update', res.locals.activity._id, parameters);

          return res.apiv3({ deletablePages });
        }
        catch (err) {
          logger.error(err);
          return res.apiv3Err(new ErrorV3('Failed to update page.', 'unknown'), 500);
        }
      }
      // when all pages are deletable
      else {
        try {
          const activityParameters = {
            ip: req.ip,
            endpoint: req.originalUrl,
          };
          const pages = await crowi.pageService.emptyTrashPage(req.user, options, activityParameters);

          activityEvent.emit('update', res.locals.activity._id, parameters);

          return res.apiv3({ pages });
        }
        catch (err) {
          logger.error(err);
          return res.apiv3Err(new ErrorV3('Failed to update page.', 'unknown'), 500);
        }
      }
    },
  );

  validator.displayList = [
    query('limit').if(value => value != null).isInt({ max: 100 }).withMessage('You should set less than 100 or not to set limit.'),
  ];

  /**
    * @swagger
    *
    *    /pages/list:
    *      get:
    *        tags: [Pages]
    *        description: Get list of pages
    *        parameters:
    *          - name: path
    *            in: query
    *            description: Path to search
    *            schema:
    *              type: string
    *          - name: limit
    *            in: query
    *            description: Limit of acquisitions
    *            schema:
    *              type: number
    *          - name: page
    *            in: query
    *            description: Page number
    *            schema:
    *              type: number
    *        responses:
    *          200:
    *            description: Succeeded to retrieve pages.
    *            content:
    *              application/json:
    *                schema:
    *                  properties:
    *                    totalCount:
    *                      type: number
    *                      description: Total count of pages
    *                      example: 3
    *                    offset:
    *                      type: number
    *                      description: Offset of pages
    *                      example: 0
    *                    limit:
    *                      type: number
    *                      description: Limit of pages
    *                      example: 10
    *                    pages:
    *                      type: array
    *                      items:
    *                        allOf:
    *                          - $ref: '#/components/schemas/Page'
    *                          - type: object
    *                            properties:
    *                              lastUpdateUser:
    *                                $ref: '#/components/schemas/User'
    */
  router.get('/list', accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired, validator.list, apiV3FormValidator, async(req, res) => {

      const path = normalizePath(req.query.path ?? '/');
      const limit = parseInt(req.query.limit ?? configManager.getConfig('customize:showPageLimitationS'));
      const page = req.query.page || 1;
      const offset = (page - 1) * limit;
      let includeTrashed = false;

      if (isTrashPage(path)) {
        includeTrashed = true;
      }

      const queryOptions = {
        offset,
        limit,
        includeTrashed,
      };

      try {
        const result = await Page.findListWithDescendants(path, req.user, queryOptions);

        result.pages.forEach((page) => {
          if (page.lastUpdateUser != null && page.lastUpdateUser instanceof User) {
            page.lastUpdateUser = serializeUserSecurely(page.lastUpdateUser);
          }
        });

        return res.apiv3(result);
      }
      catch (err) {
        logger.error('Failed to get Descendants Pages', err);
        return res.apiv3Err(err, 500);
      }
    });

  /**
   * @swagger
   *
   *
   *    /pages/duplicate:
   *      post:
   *        tags: [Pages]
   *        description: Duplicate page
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  pageId:
   *                    $ref: '#/components/schemas/ObjectId'
   *                  pageNameInput:
   *                    $ref: '#/components/schemas/PagePath'
   *                  isRecursively:
   *                    type: boolean
   *                    description: whether duplicate page with descendants
   *                  onlyDuplicateUserRelatedResources:
   *                    type: boolean
   *                    description: whether duplicate only user related resources
   *                required:
   *                  - pageId
   *        responses:
   *          200:
   *            description: Succeeded to duplicate page.
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    page:
   *                      $ref: '#/components/schemas/Page'
   *
   *          403:
   *            description: Forbidden to duplicate page.
   *          500:
   *            description: Internal server error.
   */
  router.post(
    '/duplicate',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    addActivity,
    validator.duplicatePage,
    apiV3FormValidator,
    async(req, res) => {
      const { pageId, isRecursively, onlyDuplicateUserRelatedResources } = req.body;

      const newPagePath = normalizePath(req.body.pageNameInput);

      const isCreatable = isCreatablePage(newPagePath);
      if (!isCreatable) {
        return res.apiv3Err(new ErrorV3('This page path is invalid', 'invalid_path'), 400);
      }

      if (isUserPage(newPagePath)) {
        const isExistUser = await User.isExistUserByUserPagePath(newPagePath);
        if (!isExistUser) {
          return res.apiv3Err("Unable to duplicate a page under a non-existent user's user page");
        }
      }

      // check page existence
      const isExist = (await Page.exists({ path: newPagePath, isEmpty: false }));
      if (isExist) {
        return res.apiv3Err(new ErrorV3(`Page exists '${newPagePath})'`, 'already_exists'), 409);
      }

      const page = await Page.findByIdAndViewer(pageId, req.user, null, true);

      const isEmptyAndNotRecursively = page?.isEmpty && !isRecursively;
      if (page == null || isEmptyAndNotRecursively) {
        res.code = 'Page is not found';
        logger.error('Failed to find the pages');
        return res.apiv3Err(new ErrorV3(`Page '${pageId}' is not found or forbidden`, 'notfound_or_forbidden'), 401);
      }

      const newParentPage = await crowi.pageService.duplicate(page, newPagePath, req.user, isRecursively, onlyDuplicateUserRelatedResources);
      const result = { page: serializePageSecurely(newParentPage) };

      // copy the page since it's used and updated in crowi.pageService.duplicate
      const copyPage = { ...page };
      copyPage.path = newPagePath;
      try {
        await globalNotificationService.fire(GlobalNotificationSettingEvent.PAGE_CREATE, copyPage, req.user);
      }
      catch (err) {
        logger.error('Create grobal notification failed', err);
      }

      // create subscription (parent page only)
      try {
        await crowi.inAppNotificationService.createSubscription(req.user.id, newParentPage._id, subscribeRuleNames.PAGE_CREATE);
      }
      catch (err) {
        logger.error('Failed to create subscription document', err);
      }

      const parameters = {
        targetModel: SupportedTargetModel.MODEL_PAGE,
        target: page,
        action: SupportedAction.ACTION_PAGE_DUPLICATE,
      };

      activityEvent.emit('update', res.locals.activity._id, parameters, page, preNotifyService.generatePreNotify);

      return res.apiv3(result);
    },
  );

  /**
   * @swagger
   *
   *
   *    /pages/subordinated-list:
   *      get:
   *        tags: [Pages]
   *        description: Get subordinated pages
   *        parameters:
   *          - name: path
   *            in: query
   *            description: Parent path of search
   *            schema:
   *              type: string
   *          - name: limit
   *            in: query
   *            description: Limit of acquisitions
   *            schema:
   *              type: number
   *        responses:
   *          200:
   *            description: Succeeded to retrieve pages.
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    subordinatedPages:
   *                      type: array
   *                      items:
   *                        $ref: '#/components/schemas/Page'
   */
  router.get(
    '/subordinated-list',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    async(req, res) => {
      const { path } = req.query;
      const limit = parseInt(req.query.limit) || LIMIT_FOR_LIST;

      try {
        const pageData = await Page.findByPath(path, true);
        const result = await Page.findManageableListWithDescendants(pageData, req.user, { limit });

        return res.apiv3({ subordinatedPages: result });
      }
      catch (err) {
        return res.apiv3Err(new ErrorV3('Failed to update page.', 'unknown'), 500);
      }
    },
  );

  /**
    * @swagger
    *    /pages/delete:
    *      post:
    *        tags: [Pages]
    *        description: Delete pages
    *        requestBody:
    *          content:
    *            application/json:
    *              schema:
    *                properties:
    *                  pageIdToRevisionIdMap:
    *                    type: object
    *                    description: Map of page IDs to revision IDs
    *                    example: { "5e2d6aede35da4004ef7e0b7": "5e07345972560e001761fa63" }
    *                  isCompletely:
    *                    type: boolean
    *                    description: Whether to delete pages completely
    *                  isRecursively:
    *                    type: boolean
    *                    description: Whether to delete pages recursively
    *                  isAnyoneWithTheLink:
    *                    type: boolean
    *                    description: Whether the page is restricted to anyone with the link
    *        responses:
    *          200:
    *            description: Succeeded to delete pages.
    *            content:
    *              application/json:
    *                schema:
    *                  properties:
    *                    paths:
    *                      type: array
    *                      items:
    *                        type: string
    *                      description: List of deleted page paths
    *                    isRecursively:
    *                      type: boolean
    *                      description: Whether pages were deleted recursively
    *                    isCompletely:
    *                      type: boolean
    *                      description: Whether pages were deleted completely
    */
  router.post(
    '/delete',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    validator.deletePages,
    apiV3FormValidator,
    async(req, res) => {
      const {
        pageIdToRevisionIdMap, isCompletely, isRecursively, isAnyoneWithTheLink,
      } = req.body;

      const pageIds = Object.keys(pageIdToRevisionIdMap);

      if (pageIds.length === 0) {
        return res.apiv3Err(new ErrorV3('Select pages to delete.', 'no_page_selected'), 400);
      }
      if (isAnyoneWithTheLink && pageIds.length !== 1) {
        return res.apiv3Err(new ErrorV3('Only one restricted page can be selected', 'not_single_page'), 400);
      }
      if (pageIds.length > LIMIT_FOR_MULTIPLE_PAGE_OP) {
        return res.apiv3Err(new ErrorV3(`The maximum number of pages you can select is ${LIMIT_FOR_MULTIPLE_PAGE_OP}.`, 'exceeded_maximum_number'), 400);
      }

      let pagesToDelete;
      try {
        pagesToDelete = await Page.findByIdsAndViewer(pageIds, req.user, null, true, isAnyoneWithTheLink);
      }
      catch (err) {
        logger.error('Failed to find pages to delete.', err);
        return res.apiv3Err(new ErrorV3('Failed to find pages to delete.'));
      }
      if (isAnyoneWithTheLink && pagesToDelete[0].grant !== PageGrant.GRANT_RESTRICTED) {
        return res.apiv3Err(new ErrorV3('The grant of the retrieved page is not restricted'), 500);
      }

      let pagesCanBeDeleted;
      if (isCompletely) {
        pagesCanBeDeleted = await crowi.pageService.filterPagesByCanDeleteCompletely(pagesToDelete, req.user, isRecursively);
      }
      else {
        const filteredPages = pagesToDelete.filter(p => p.isEmpty || p.isUpdatable(pageIdToRevisionIdMap[p._id].toString()));
        pagesCanBeDeleted = await crowi.pageService.filterPagesByCanDelete(filteredPages, req.user, isRecursively);
      }

      if (pagesCanBeDeleted.length === 0) {
        const msg = 'No pages can be deleted.';
        return res.apiv3Err(new ErrorV3(msg), 500);
      }

      // run delete
      const activityParameters = {
        ip: req.ip,
        endpoint: req.originalUrl,
      };
      const options = { isCompletely, isRecursively };
      crowi.pageService.deleteMultiplePages(pagesCanBeDeleted, req.user, options, activityParameters);

      return res.apiv3({ paths: pagesCanBeDeleted.map(p => p.path), isRecursively, isCompletely });
    },
  );

  /**
   * @swagger
   *
   *    /pages/convert-pages-by-path:
   *      post:
   *        tags: [Pages]
   *        description: Convert pages by path
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  convertPath:
   *                    type: string
   *                    description: Path to convert
   *                    example: /user/alice
   *        responses:
   *          200:
   *            description: Succeeded to convert pages.
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  description: Empty object
   */
  router.post(
    '/convert-pages-by-path',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequiredStrictly,
    excludeReadOnlyUser,
    adminRequired,
    validator.convertPagesByPath,
    apiV3FormValidator,
    async(req, res) => {
      const { convertPath } = req.body;

      // Convert by path
      const normalizedPath = normalizePath(convertPath);
      try {
        await crowi.pageService.normalizeParentByPath(normalizedPath, req.user);
      }
      catch (err) {
        logger.error(err);

        if (isV5ConversionError(err)) {
          return res.apiv3Err(new ErrorV3(err.message, err.code), 400);
        }

        return res.apiv3Err(new ErrorV3('Failed to convert pages.'), 400);
      }

      return res.apiv3({});
    },
  );

  /**
   * @swagger
   *
   *    /pages/legacy-pages-migration:
   *      post:
   *        tags: [Pages]
   *        description: Migrate legacy pages
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  pageIds:
   *                    type: array
   *                    items:
   *                      type: string
   *                    description: List of page IDs to migrate
   *                  isRecursively:
   *                    type: boolean
   *                    description: Whether to migrate pages recursively
   *        responses:
   *          200:
   *            description: Succeeded to migrate legacy pages.
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  description: Empty object
  */
  router.post(
    '/legacy-pages-migration',
    accessTokenParser([SCOPE.WRITE.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    excludeReadOnlyUser,
    validator.legacyPagesMigration,
    apiV3FormValidator,
    async(req, res) => {
      const { pageIds: _pageIds, isRecursively } = req.body;

      // Convert by pageIds
      const pageIds = _pageIds == null ? [] : _pageIds;

      if (pageIds.length > LIMIT_FOR_MULTIPLE_PAGE_OP) {
        return res.apiv3Err(new ErrorV3(`The maximum number of pages you can select is ${LIMIT_FOR_MULTIPLE_PAGE_OP}.`, 'exceeded_maximum_number'), 400);
      }
      if (pageIds.length === 0) {
        return res.apiv3Err(new ErrorV3('No page is selected.'), 400);
      }

      try {
        if (isRecursively) {
          await crowi.pageService.normalizeParentByPageIdsRecursively(pageIds, req.user);
        }
        else {
          await crowi.pageService.normalizeParentByPageIds(pageIds, req.user);
        }
      }
      catch (err) {
        return res.apiv3Err(new ErrorV3(`Failed to migrate pages: ${err.message}`), 500);
      }

      return res.apiv3({});
    },
  );

  /**
   * @swagger
   *
   *    /pages/v5-migration-status:
   *      get:
   *        tags: [Pages]
   *        description: Get V5 migration status
   *        responses:
   *          200:
   *            description: Return V5 migration status
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    isV5Compatible:
   *                      type: boolean
   *                      description: Whether the app is V5 compatible
   *                    migratablePagesCount:
   *                      type: number
   *                      description: Number of pages that can be migrated
   */
  router.get('/v5-migration-status', accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }), loginRequired, async(req, res) => {
    try {
      const isV5Compatible = configManager.getConfig('app:isV5Compatible');
      const migratablePagesCount = req.user != null ? await crowi.pageService.countPagesCanNormalizeParentByUser(req.user) : null; // null check since not using loginRequiredStrictly
      return res.apiv3({ isV5Compatible, migratablePagesCount });
    }
    catch (err) {
      return res.apiv3Err(new ErrorV3('Failed to obtain migration status'));
    }
  });

  return router;
};
