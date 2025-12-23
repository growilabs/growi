import { body } from 'express-validator';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import { PathAlreadyExistsError } from '../models/errors';
import { GlobalNotificationSettingEvent } from '../models/GlobalNotificationSetting';
import PageTagRelation from '../models/page-tag-relation';
import UpdatePost from '../models/update-post';

/**
 * @swagger
 *  tags:
 *    name: Pages
 */

/* eslint-disable no-use-before-define */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi, app) => {
  const logger = loggerFactory('growi:routes:page');

  const { pagePathUtils } = require('@growi/core/dist/utils');

  /** @type {import('../models/page').PageModel} */
  const Page = crowi.model('Page');

  const PageRedirect = mongoose.model('PageRedirect');

  const ApiResponse = require('../util/apiResponse');

  const globalNotificationService = crowi.getGlobalNotificationService();

  const actions = {};

  // async function showPageForPresentation(req, res, next) {
  //   const id = req.params.id;
  //   const { revisionId } = req.query;

  //   let page = await Page.findByIdAndViewer(id, req.user, null, true, true);

  //   if (page == null) {
  //     next();
  //   }

  //   // empty page
  //   if (page.isEmpty) {
  //     // redirect to page (path) url
  //     const url = new URL('https://dummy.origin');
  //     url.pathname = page.path;
  //     Object.entries(req.query).forEach(([key, value], i) => {
  //       url.searchParams.append(key, value);
  //     });
  //     return res.safeRedirect(urljoin(url.pathname, url.search));

  //   }

  //   const renderVars = {};

  //   // populate
  //   page = await page.populateDataToMakePresentation(revisionId);

  //   if (page != null) {
  //     addRenderVarsForPresentation(renderVars, page);
  //   }

  //   return res.render('page_presentation', renderVars);
  // }

  /**
   * switch action
   *   - presentation mode
   *   - by behaviorType
   */
  // actions.showPage = async function(req, res, next) {
  //   // presentation mode
  //   if (req.query.presentation) {
  //     return showPageForPresentation(req, res, next);
  //   }
  //   // delegate to showPageForGrowiBehavior
  //   return showPageForGrowiBehavior(req, res, next);
  // };

  const api = {};
  const validator = {};

  actions.api = api;
  actions.validator = validator; /**
   * @swagger
   *
   * components:
   *   schemas:
   *     PageTagsData:
   *       type: object
   *       properties:
   *         tags:
   *           type: array
   *           items:
   *             type: string
   *           description: Array of tag names associated with the page
   *           example: ["javascript", "tutorial", "backend"]
   *
   *   responses:
   *     PageTagsSuccess:
   *       description: Successfully retrieved page tags
   *       content:
   *         application/json:
   *           schema:
   *             allOf:
   *               - $ref: '#/components/schemas/ApiResponseSuccess'
   *               - $ref: '#/components/schemas/PageTagsData'
   *
   * /pages.getPageTag:
   *   get:
   *     tags: [Pages]
   *     operationId: getPageTag
   *     summary: Get page tags
   *     description: Retrieve all tags associated with a specific page
   *     parameters:
   *       - in: query
   *         name: pageId
   *         required: true
   *         description: Unique identifier of the page
   *         schema:
   *           type: string
   *           format: ObjectId
   *           example: "507f1f77bcf86cd799439011"
   *     responses:
   *       200:
   *         $ref: '#/components/responses/PageTagsSuccess'
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       404:
   *         $ref: '#/components/responses/NotFound'
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {get} /pages.getPageTag get page tags
   * @apiName GetPageTag
   * @apiGroup Page
   *
   * @apiParam {String} pageId
   */
  api.getPageTag = async (req, res) => {
    const result = {};
    try {
      result.tags = await PageTagRelation.listTagNamesByPage(req.query.pageId);
    } catch (err) {
      return res.json(ApiResponse.error(err));
    }
    return res.json(ApiResponse.success(result));
  };

  /**
   * @swagger
   *
   * components:
   *   schemas:
   *     UpdatePostData:
   *       type: object
   *       properties:
   *         updatePost:
   *           type: array
   *           items:
   *             type: string
   *           description: Array of channel names for notifications
   *           example: ["general", "development", "notifications"]
   *
   *   responses:
   *     UpdatePostSuccess:
   *       description: Successfully retrieved UpdatePost settings
   *       content:
   *         application/json:
   *           schema:
   *             allOf:
   *               - $ref: '#/components/schemas/ApiResponseSuccess'
   *               - $ref: '#/components/schemas/UpdatePostData'
   *
   * /pages.updatePost:
   *   get:
   *     tags: [Pages]
   *     operationId: getUpdatePost
   *     summary: Get UpdatePost settings
   *     description: Retrieve UpdatePost notification settings for a specific path
   *     parameters:
   *       - in: query
   *         name: path
   *         required: true
   *         description: Page path to get UpdatePost settings for
   *         schema:
   *           type: string
   *           example: "/user/example"
   *         examples:
   *           userPage:
   *             value: "/user/john"
   *             description: User page path
   *           projectPage:
   *             value: "/project/myproject"
   *             description: Project page path
   *     responses:
   *       200:
   *         $ref: '#/components/responses/UpdatePostSuccess'
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  /**
   * @api {get} /pages.updatePost
   * @apiName Get UpdatePost setting list
   * @apiGroup Page
   *
   * @apiParam {String} path
   */
  api.getUpdatePost = (req, res) => {
    const path = req.query.path;

    if (!path) {
      return res.json(ApiResponse.error({}));
    }

    UpdatePost.findSettingsByPath(path)
      .then((data) => {
        // eslint-disable-next-line no-param-reassign
        data = data.map((e) => {
          return e.channel;
        });
        logger.debug('Found updatePost data', data);
        const result = { updatePost: data };
        return res.json(ApiResponse.success(result));
      })
      .catch((err) => {
        logger.debug('Error occured while get setting', err);
        return res.json(ApiResponse.error({}));
      });
  };

  validator.remove = [
    body('completely')
      .custom((v) => v === 'true' || v === true || v == null)
      .withMessage(
        'The body property "completely" must be "true" or true. (Omit param for false)',
      ),
    body('recursively')
      .custom((v) => v === 'true' || v === true || v == null)
      .withMessage(
        'The body property "recursively" must be "true" or true. (Omit param for false)',
      ),
  ];

  /**
   * @swagger
   *
   * components:
   *   schemas:
   *     PageRemoveData:
   *       type: object
   *       required:
   *         - path
   *       properties:
   *         path:
   *           type: string
   *           description: Path of the deleted page
   *           example: "/user/example"
   *         isRecursively:
   *           type: boolean
   *           description: Whether deletion was recursive
   *           example: true
   *         isCompletely:
   *           type: boolean
   *           description: Whether deletion was complete
   *           example: false
   *
   *   responses:
   *     PageRemoveSuccess:
   *       description: Page successfully deleted
   *       content:
   *         application/json:
   *           schema:
   *             allOf:
   *               - $ref: '#/components/schemas/ApiResponseSuccess'
   *               - $ref: '#/components/schemas/PageRemoveData'
   *
   * /pages.remove:
   *   post:
   *     tags: [Pages]
   *     operationId: removePage
   *     summary: Remove page
   *     description: Delete a page either softly or completely, with optional recursive deletion
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - page_id
   *             properties:
   *               page_id:
   *                 type: string
   *                 format: ObjectId
   *                 description: Unique identifier of the page to delete
   *                 example: "507f1f77bcf86cd799439011"
   *               revision_id:
   *                 type: string
   *                 format: ObjectId
   *                 description: Revision ID for conflict detection
   *                 example: "507f1f77bcf86cd799439012"
   *               completely:
   *                 type: boolean
   *                 description: Whether to delete the page completely (true) or soft delete (false)
   *                 default: false
   *                 example: false
   *               recursively:
   *                 type: boolean
   *                 description: Whether to delete child pages recursively
   *                 default: false
   *                 example: true
   *           examples:
   *             softDelete:
   *               summary: Soft delete single page
   *               value:
   *                 page_id: "507f1f77bcf86cd799439011"
   *                 revision_id: "507f1f77bcf86cd799439012"
   *             recursiveDelete:
   *               summary: Recursive soft delete
   *               value:
   *                 page_id: "507f1f77bcf86cd799439011"
   *                 recursively: true
   *             completeDelete:
   *               summary: Complete deletion
   *               value:
   *                 page_id: "507f1f77bcf86cd799439011"
   *                 completely: true
   *     responses:
   *       200:
   *         $ref: '#/components/responses/PageRemoveSuccess'
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       404:
   *         $ref: '#/components/responses/NotFound'
   *       409:
   *         $ref: '#/components/responses/Conflict'
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  api.remove = async (req, res) => {
    const pageId = req.body.page_id;
    const previousRevision = req.body.revision_id || null;

    const { recursively: isRecursively, completely: isCompletely } = req.body;

    const options = {};

    const activityParameters = {
      ip: req.ip,
      endpoint: req.originalUrl,
    };

    /** @type {import('../models/page').PageDocument | undefined} */
    const page = await Page.findByIdAndViewer(pageId, req.user, null, true);

    if (page == null) {
      return res.json(
        ApiResponse.error(
          `Page '${pageId}' is not found or forbidden`,
          'notfound_or_forbidden',
        ),
      );
    }

    if (page.isEmpty && !isRecursively) {
      return res.json(
        ApiResponse.error(
          'Empty pages cannot be single deleted',
          'single_deletion_empty_pages',
        ),
      );
    }

    const creatorId = await crowi.pageService.getCreatorIdForCanDelete(page);

    logger.debug('Delete page', page._id, page.path);

    try {
      if (isCompletely) {
        const userRelatedGroups =
          await crowi.pageGrantService.getUserRelatedGroups(req.user);
        const canDeleteCompletely = crowi.pageService.canDeleteCompletely(
          page,
          creatorId,
          req.user,
          isRecursively,
          userRelatedGroups,
        );
        if (!canDeleteCompletely) {
          return res.json(
            ApiResponse.error(
              'You cannot delete this page completely',
              'complete_deletion_not_allowed_for_user',
            ),
          );
        }

        if (pagePathUtils.isUsersHomepage(page.path)) {
          if (!crowi.pageService.canDeleteUserHomepageByConfig()) {
            return res.json(
              ApiResponse.error('Could not delete user homepage'),
            );
          }
          if (
            !(await crowi.pageService.isUsersHomepageOwnerAbsent(page.path))
          ) {
            return res.json(
              ApiResponse.error('Could not delete user homepage'),
            );
          }
        }

        await crowi.pageService.deleteCompletely(
          page,
          req.user,
          options,
          isRecursively,
          false,
          activityParameters,
        );
      } else {
        // behave like not found
        const notRecursivelyAndEmpty = page.isEmpty && !isRecursively;
        if (notRecursivelyAndEmpty) {
          return res.json(
            ApiResponse.error(`Page '${pageId}' is not found.`, 'notfound'),
          );
        }

        if (!page.isEmpty && !page.isUpdatable(previousRevision)) {
          return res.json(
            ApiResponse.error(
              "Someone could update this page, so couldn't delete.",
              'outdated',
            ),
          );
        }

        if (
          !crowi.pageService.canDelete(page, creatorId, req.user, isRecursively)
        ) {
          return res.json(
            ApiResponse.error('You cannot delete this page', 'user_not_admin'),
          );
        }

        if (pagePathUtils.isUsersHomepage(page.path)) {
          if (!crowi.pageService.canDeleteUserHomepageByConfig()) {
            return res.json(
              ApiResponse.error('Could not delete user homepage'),
            );
          }
          if (
            !(await crowi.pageService.isUsersHomepageOwnerAbsent(page.path))
          ) {
            return res.json(
              ApiResponse.error('Could not delete user homepage'),
            );
          }
        }

        await crowi.pageService.deletePage(
          page,
          req.user,
          options,
          isRecursively,
          activityParameters,
        );
      }
    } catch (err) {
      logger.error('Error occured while get setting', err);
      return res.json(ApiResponse.error('Failed to delete page.', err.message));
    }

    logger.debug('Page deleted', page.path);
    const result = {};
    result.path = page.path;
    result.isRecursively = isRecursively;
    result.isCompletely = isCompletely;

    res.json(ApiResponse.success(result));

    try {
      // global notification
      await globalNotificationService.fire(
        GlobalNotificationSettingEvent.PAGE_DELETE,
        page,
        req.user,
      );
    } catch (err) {
      logger.error('Delete notification failed', err);
    }
  };

  validator.revertRemove = [
    body('recursively')
      .optional()
      .custom((v) => v === 'true' || v === true || v == null)
      .withMessage(
        'The body property "recursively" must be "true" or true. (Omit param for false)',
      ),
  ];

  /**
   * @swagger
   *
   * components:
   *   schemas:
   *     PageRevertData:
   *       type: object
   *       properties:
   *         page:
   *           type: object
   *           description: Restored page object
   *           properties:
   *             _id:
   *               type: string
   *               format: ObjectId
   *               example: "507f1f77bcf86cd799439011"
   *             path:
   *               type: string
   *               example: "/user/example"
   *             title:
   *               type: string
   *               example: "Example Page"
   *             status:
   *               type: string
   *               example: "published"
   *
   *   responses:
   *     PageRevertSuccess:
   *       description: Page successfully restored
   *       content:
   *         application/json:
   *           schema:
   *             allOf:
   *               - $ref: '#/components/schemas/ApiResponseSuccess'
   *               - $ref: '#/components/schemas/PageRevertData'
   *
   * /pages.revertRemove:
   *   post:
   *     tags: [Pages]
   *     operationId: revertRemovePage
   *     summary: Revert removed page
   *     description: Restore a previously deleted (soft-deleted) page
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - page_id
   *             properties:
   *               page_id:
   *                 type: string
   *                 format: ObjectId
   *                 description: Unique identifier of the page to restore
   *                 example: "507f1f77bcf86cd799439011"
   *               recursively:
   *                 type: boolean
   *                 description: Whether to restore child pages recursively
   *                 default: false
   *                 example: true
   *           examples:
   *             singleRevert:
   *               summary: Revert single page
   *               value:
   *                 page_id: "507f1f77bcf86cd799439011"
   *             recursiveRevert:
   *               summary: Revert page and children
   *               value:
   *                 page_id: "507f1f77bcf86cd799439011"
   *                 recursively: true
   *     responses:
   *       200:
   *         $ref: '#/components/responses/PageRevertSuccess'
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       404:
   *         $ref: '#/components/responses/NotFound'
   *       409:
   *         $ref: '#/components/responses/Conflict'
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  api.revertRemove = async (req, res, options) => {
    const pageId = req.body.page_id;

    // get recursively flag
    const isRecursively = req.body.recursively;

    const activityParameters = {
      ip: req.ip,
      endpoint: req.originalUrl,
    };

    let page;
    try {
      page = await Page.findByIdAndViewer(pageId, req.user);
      if (page == null) {
        throw new Error(
          `Page '${pageId}' is not found or forbidden`,
          'notfound_or_forbidden',
        );
      }
      page = await crowi.pageService.revertDeletedPage(
        page,
        req.user,
        {},
        isRecursively,
        activityParameters,
      );
    } catch (err) {
      if (err instanceof PathAlreadyExistsError) {
        logger.error('Path already exists', err);
        return res.json(
          ApiResponse.error(err, 'already_exists', err.targetPath),
        );
      }
      logger.error('Error occured while get setting', err);
      return res.json(ApiResponse.error(err));
    }

    const result = {};
    result.page = page; // TODO consider to use serializePageSecurely method -- 2018.08.06 Yuki Takei

    return res.json(ApiResponse.success(result));
  };

  /**
   * @swagger
   *
   * components:
   *   schemas:
   *     PageUnlinkData:
   *       type: object
   *       properties:
   *         path:
   *           type: string
   *           description: Path for which redirects were removed
   *           example: "/user/example"
   *
   *   responses:
   *     PageUnlinkSuccess:
   *       description: Successfully removed page redirects
   *       content:
   *         application/json:
   *           schema:
   *             allOf:
   *               - $ref: '#/components/schemas/ApiResponseSuccess'
   *               - $ref: '#/components/schemas/PageUnlinkData'
   *
   * /pages.unlink:
   *   post:
   *     tags: [Pages]
   *     operationId: unlinkPage
   *     summary: Remove page redirects
   *     description: Remove all redirect entries that point to the specified page path
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - path
   *             properties:
   *               path:
   *                 type: string
   *                 description: Target path to remove redirects for
   *                 example: "/user/example"
   *           examples:
   *             unlinkPage:
   *               summary: Remove redirects to a page
   *               value:
   *                 path: "/user/example"
   *     responses:
   *       200:
   *         $ref: '#/components/responses/PageUnlinkSuccess'
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       403:
   *         $ref: '#/components/responses/Forbidden'
   *       500:
   *         $ref: '#/components/responses/InternalServerError'
   */
  api.unlink = async (req, res) => {
    const path = req.body.path;

    try {
      await PageRedirect.removePageRedirectsByToPath(path);
      logger.debug('Redirect Page deleted', path);
    } catch (err) {
      logger.error('Error occured while get setting', err);
      return res.json(ApiResponse.error('Failed to delete redirect page.'));
    }

    const result = { path };
    return res.json(ApiResponse.success(result));
  };

  return actions;
};
