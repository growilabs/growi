
import { PageGrant } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import { serializeUserSecurely } from '@growi/core/dist/models/serializers';
import { isCreatablePage, isTrashPage, isUserPage } from '@growi/core/dist/utils/page-path-utils';
import { normalizePath, addHeadingSlash } from '@growi/core/dist/utils/path-utils';
import express from 'express';
import { body, query } from 'express-validator';

import { SupportedTargetModel, SupportedAction } from '~/interfaces/activity';
import { subscribeRuleNames } from '~/interfaces/in-app-notification';
import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting';
import PageTagRelation from '~/server/models/page-tag-relation';
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

/**
 * @swagger
 *  tags:
 *    name: Pages
 */

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      Tags:
 *        description: Tags
 *        type: array
 *        items:
 *          $ref: '#/components/schemas/Tag/properties/name'
 *        example: ['daily', 'report', 'tips']
 *
 *      Tag:
 *        description: Tag
 *        type: object
 *        properties:
 *          _id:
 *            type: string
 *            description: tag ID
 *            example: 5e2d6aede35da4004ef7e0b7
 *          name:
 *            type: string
 *            description: tag name
 *            example: daily
 *          count:
 *            type: number
 *            description: Count of tagged pages
 *            example: 3
 */

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      Page:
 *        description: Page
 *        type: object
 *        properties:
 *          _id:
 *            type: string
 *            description: page ID
 *            example: 5e07345972560e001761fa63
 *          __v:
 *            type: number
 *            description: DB record version
 *            example: 0
 *          commentCount:
 *            type: number
 *            description: count of comments
 *            example: 3
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 *          creator:
 *            $ref: '#/components/schemas/User'
 *          extended:
 *            type: object
 *            description: extend data
 *            example: {}
 *          grant:
 *            type: number
 *            description: grant
 *            example: 1
 *          grantedUsers:
 *            type: array
 *            description: granted users
 *            items:
 *              type: string
 *              description: user ID
 *            example: ["5ae5fccfc5577b0004dbd8ab"]
 *          lastUpdateUser:
 *            $ref: '#/components/schemas/User'
 *          liker:
 *            type: array
 *            description: granted users
 *            items:
 *              type: string
 *              description: user ID
 *            example: []
 *          path:
 *            type: string
 *            description: page path
 *            example: /Sandbox/Math
 *          revision:
 *            type: string
 *            description: revision ID
 *            example: ["5ae5fccfc5577b0004dbd8ab"]
 *          seenUsers:
 *            type: array
 *            description: granted users
 *            items:
 *              type: string
 *              description: user ID
 *            example: ["5ae5fccfc5577b0004dbd8ab"]
 *          status:
 *            type: string
 *            description: status
 *            enum:
 *              - 'wip'
 *              - 'published'
 *              - 'deleted'
 *              - 'deprecated'
 *            example: published
 *          updatedAt:
 *            type: string
 *            description: date updated at
 *            example: 2010-01-01T00:00:00.000Z
 */

module.exports = (crowi) => {
  const accessTokenParser = require('../../../middlewares/access-token-parser')(crowi);
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
      body('revisionId').optional({ nullable: true }).isMongoId().withMessage('revisionId is required'), // required when v4
      body('newPagePath').isLength({ min: 1 }).withMessage('newPagePath is required'),
      body('isRecursively').if(value => value != null).isBoolean().withMessage('isRecursively must be boolean'),
      body('isRenameRedirect').if(value => value != null).isBoolean().withMessage('isRenameRedirect must be boolean'),
      body('updateMetadata').if(value => value != null).isBoolean().withMessage('updateMetadata must be boolean'),
      body('isMoveMode').if(value => value != null).isBoolean().withMessage('isMoveMode must be boolean'),
    ],
    resumeRenamePage: [
      body('pageId').isMongoId().withMessage('pageId is required'),
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
   *        responses:
   *          200:
   *            description: Return pages recently updated
   *
   */
  router.get('/recent', accessTokenParser, loginRequired, validator.recent, apiV3FormValidator, async(req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const includeWipPage = req.query.includeWipPage === 'true'; // Need validation using express-validator

    const queryOptions = {
      offset,
      limit,
      includeWipPage,
      includeTrashed: false,
      isRegExpEscapedFromPath: true,
      sort: 'updatedAt',
      desc: -1,
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
   *      post:
   *        tags: [Pages]
   *        operationId: renamePage
   *        description: Rename page
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  pageId:
   *                    $ref: '#/components/schemas/Page/properties/_id'
   *                  path:
   *                    $ref: '#/components/schemas/Page/properties/path'
   *                  revisionId:
   *                    type: string
   *                    description: revision ID
   *                    example: 5e07345972560e001761fa63
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
  router.put('/rename', accessTokenParser, loginRequiredStrictly, excludeReadOnlyUser, validator.renamePage, apiV3FormValidator, async(req, res) => {
    const { pageId, revisionId } = req.body;

    let newPagePath = normalizePath(req.body.newPagePath);

    const options = {
      isRecursively: req.body.isRecursively,
      createRedirectPage: req.body.isRenameRedirect,
      updateMetadata: req.body.updateMetadata,
      isMoveMode: req.body.isMoveMode,
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
  });

  router.post('/resume-rename', accessTokenParser, loginRequiredStrictly, validator.resumeRenamePage, apiV3FormValidator,
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
    });

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
   */
  router.delete('/empty-trash', accessTokenParser, loginRequired, excludeReadOnlyUser, addActivity, apiV3FormValidator, async(req, res) => {
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
  });

  validator.displayList = [
    query('limit').if(value => value != null).isInt({ max: 100 }).withMessage('You should set less than 100 or not to set limit.'),
  ];

  router.get('/list', accessTokenParser, loginRequired, validator.displayList, apiV3FormValidator, async(req, res) => {

    const { path } = req.query;
    const limit = parseInt(req.query.limit) || await crowi.configManager.getConfig('crowi', 'customize:showPageLimitationS') || 10;
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
   *        operationId: duplicatePage
   *        description: Duplicate page
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  pageId:
   *                    $ref: '#/components/schemas/Page/properties/_id'
   *                  pageNameInput:
   *                    $ref: '#/components/schemas/Page/properties/path'
   *                  isRecursively:
   *                    type: boolean
   *                    description: whether duplicate page with descendants
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
  router.post('/duplicate', accessTokenParser, loginRequiredStrictly, excludeReadOnlyUser, addActivity, validator.duplicatePage, apiV3FormValidator,
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
    });

  /**
   * @swagger
   *
   *
   *    /pages/subordinated-list:
   *      get:
   *        tags: [Pages]
   *        operationId: subordinatedList
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
   *                    subordinatedPaths:
   *                      type: object
   *                      description: descendants page
   *          500:
   *            description: Internal server error.
   */
  router.get('/subordinated-list', accessTokenParser, loginRequired, async(req, res) => {
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

  });

  router.post('/delete', accessTokenParser, loginRequiredStrictly, excludeReadOnlyUser, validator.deletePages, apiV3FormValidator, async(req, res) => {
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
  });


  // eslint-disable-next-line max-len
  router.post('/convert-pages-by-path', accessTokenParser, loginRequiredStrictly, excludeReadOnlyUser, adminRequired, validator.convertPagesByPath, apiV3FormValidator, async(req, res) => {
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
  });

  // eslint-disable-next-line max-len
  router.post('/legacy-pages-migration', accessTokenParser, loginRequired, excludeReadOnlyUser, validator.legacyPagesMigration, apiV3FormValidator, async(req, res) => {
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
  });

  router.get('/v5-migration-status', accessTokenParser, loginRequired, async(req, res) => {
    try {
      const isV5Compatible = crowi.configManager.getConfig('crowi', 'app:isV5Compatible');
      const migratablePagesCount = req.user != null ? await crowi.pageService.countPagesCanNormalizeParentByUser(req.user) : null; // null check since not using loginRequiredStrictly
      return res.apiv3({ isV5Compatible, migratablePagesCount });
    }
    catch (err) {
      return res.apiv3Err(new ErrorV3('Failed to obtain migration status'));
    }
  });

  return router;
};
