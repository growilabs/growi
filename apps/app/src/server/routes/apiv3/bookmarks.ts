import { SCOPE } from '@growi/core/dist/interfaces';
import {
  isUserPage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';
import mongoose, { type HydratedDocument } from 'mongoose';

import type { bookmarks } from '~/generated/prisma/client';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type { IBookmarkInfo } from '~/interfaces/bookmark-info';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { PageDocument, PageModel } from '~/server/models/page';
import { serializeBookmarkSecurely } from '~/server/models/serializers/bookmark-serializer';
import { configManager } from '~/server/service/config-manager';
import { preNotifyService } from '~/server/service/pre-notify';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import BookmarkFolder from '../../models/bookmark-folder';

const logger = loggerFactory('growi:routes:apiv3:bookmarks');

import type { Router } from 'express';
import express from 'express';
import { body, param, query } from 'express-validator';

const router = express.Router();

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      Bookmark:
 *        description: Bookmark
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
 *          createdAt:
 *            type: string
 *            description: date created at
 *            example: 2010-01-01T00:00:00.000Z
 *          page:
 *            $ref: '#/components/schemas/Page'
 *          user:
 *            $ref: '#/components/schemas/ObjectId'
 *      Bookmarks:
 *        description: User Root Bookmarks
 *        type: object
 *        properties:
 *          userRootBookmarks:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/Bookmark'
 *      BookmarkParams:
 *        description: BookmarkParams
 *        type: object
 *        properties:
 *          pageId:
 *            type: string
 *            description: page ID
 *            example: 5e07345972560e001761fa63
 *          bool:
 *            type: boolean
 *            description: boolean for bookmark status
 *
 *      BookmarkInfo:
 *        description: BookmarkInfo
 *        type: object
 *        properties:
 *          sumOfBookmarks:
 *            type: number
 *            description: how many people bookmarked the page
 *          isBookmarked:
 *            type: boolean
 *            description: Whether the request user bookmarked (will be returned if the user is included in the request)
 *          pageId:
 *            type: string
 *            description: page ID
 *            example: 5e07345972560e001761fa63
 *          bookmarkedUsers:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/User'
 */
export const setup = (crowi: Crowi): Router => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);
  const loginRequired = loginRequiredFactory(crowi, true);
  const addActivity = generateAddActivityMiddleware();

  const activityEvent = crowi.events.activity;
  const bookmarkEvent = crowi.events.bookmark;

  const validator = {
    bookmarks: [body('pageId').isString(), body('bool').isBoolean()],
    bookmarkInfo: [query('pageId').isMongoId()],
    userBookmarkList: [
      param('userId').isMongoId().withMessage('userId is required'),
    ],
  };

  /**
   * @swagger
   *
   *    /bookmarks/info:
   *      get:
   *        tags: [Bookmarks]
   *        summary: /bookmarks/info
   *        description: Get bookmarked info
   *        parameters:
   *          - name: pageId
   *            in: query
   *            description: page id
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Succeeded to get bookmark info.
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/BookmarkInfo'
   */
  router.get(
    '/info',
    accessTokenParser([SCOPE.READ.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequired,
    validator.bookmarkInfo,
    apiV3FormValidator,
    async (req, res) => {
      const { user } = req;
      const { pageId } = req.query;

      // Prevent NoSQL injection - ensure pageId is a string
      if (typeof pageId !== 'string') {
        return res.status(400).apiv3Err('Invalid pageId parameter', 400);
      }

      const responsesParams: IBookmarkInfo = {
        sumOfBookmarks: 0,
        isBookmarked: false,
        bookmarkedUsers: [],
        pageId: '',
      };

      try {
        const bookmarks = await prisma.bookmarks.findMany({
          where: { pageId: pageId },
          include: { user: true },
        });
        const users = bookmarks.map((bookmark) =>
          bookmark.user.serializeSecurely(),
        );
        responsesParams.sumOfBookmarks = bookmarks.length;
        responsesParams.bookmarkedUsers =
          users as IBookmarkInfo['bookmarkedUsers'];
        responsesParams.pageId = pageId;
      } catch (err) {
        logger.error('get-bookmark-document-failed', err);
        return res.apiv3Err(err, 500);
      }

      // guest user only get bookmark count
      if (user == null) {
        return res.apiv3(responsesParams);
      }

      try {
        const bookmark = await prisma.bookmarks.findByPageIdAndUserId(
          pageId,
          user._id,
        );
        responsesParams.isBookmarked = bookmark != null;
        return res.apiv3(responsesParams);
      } catch (err) {
        logger.error('get-bookmark-state-failed', err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  // select page from bookmark where userid = userid
  /**
   * @swagger
   *
   *    /bookmarks/{userId}:
   *      get:
   *        tags: [Bookmarks]
   *        summary: /bookmarks/{userId}
   *        description: Get my bookmarked status
   *        parameters:
   *          - name: userId
   *            in: path
   *            required: true
   *            description: user id
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Succeeded to get my bookmarked status.
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/Bookmarks'
   */
  router.get(
    '/:userId',
    accessTokenParser([SCOPE.READ.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequired,
    validator.userBookmarkList,
    apiV3FormValidator,
    async (req, res) => {
      const { userId } = req.params;

      if (userId == null) {
        return res.apiv3Err('User id is not found or forbidden', 400);
      }

      try {
        const bookmarkIdsInFolders = await BookmarkFolder.distinct(
          'bookmarks',
          { owner: userId },
        );

        const userRootBookmarks = await prisma.bookmarks.findMany({
          where: {
            id: { notIn: bookmarkIdsInFolders },
            userId,
          },
          include: {
            page: {
              include: {
                lastUpdateUser: true,
              },
            },
          },
        });

        const disabledUserPage = configManager.getConfig(
          'security:disableUserPages',
        );

        const filteredBookmarks = disabledUserPage
          ? userRootBookmarks.filter(
              (bookmark) =>
                bookmark.page != null &&
                !isUserPage(bookmark.page.path) &&
                !isUsersTopPage(bookmark.page.path),
            )
          : userRootBookmarks;

        // serialize Bookmark
        const serializedUserRootBookmarks = filteredBookmarks.map((bookmark) =>
          serializeBookmarkSecurely(bookmark),
        );

        return res.apiv3({
          // page is null when the bookmarked page has been completely
          // deleted -- bookmarks are intentionally left orphaned in that case
          userRootBookmarks: serializedUserRootBookmarks.map((bookmark) => ({
            ...bookmark,
            user: bookmark.userId,
            page:
              bookmark.page == null
                ? null
                : {
                    ...bookmark.page,
                    creator: bookmark.page.creatorId,
                    deleteUser: bookmark.page.deleteUserId,
                    revision: bookmark.page.revisionId,
                    parent: bookmark.page.parentId,
                  },
          })),
        });
      } catch (err) {
        logger.error('get-bookmark-failed', err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  /**
   * @swagger
   *
   *    /bookmarks:
   *      put:
   *        tags: [Bookmarks]
   *        summary: /bookmarks
   *        description: Update bookmarked status
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/BookmarkParams'
   *        responses:
   *          200:
   *            description: Succeeded to update bookmarked status.
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    bookmark:
   *                      $ref: '#/components/schemas/Bookmark'
   */
  router.put(
    '/',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequiredStrictly,
    addActivity,
    validator.bookmarks,
    apiV3FormValidator,
    async (req, res) => {
      const { pageId, bool } = req.body;
      const userId = req.user?._id;

      if (userId == null) {
        return res.apiv3Err('A logged in user is required.');
      }

      const Page: PageModel = mongoose.model<
        HydratedDocument<PageDocument>,
        PageModel
      >('Page');

      let page: HydratedDocument<PageDocument> | null;
      let bookmark: bookmarks | null;
      try {
        page = await Page.findByIdAndViewer(pageId, req.user, undefined, true);
        if (page == null) {
          return res.apiv3Err(`Page '${pageId}' is not found or forbidden`);
        }

        bookmark = await prisma.bookmarks.findByPageIdAndUserId(
          page._id,
          req.user._id,
        );

        if (bookmark == null) {
          if (bool) {
            bookmark = await prisma.bookmarks.add(page._id, req.user._id);
            bookmarkEvent.emit('create', pageId);
          } else {
            logger.warn(
              `Removing the bookmark for ${page._id} by ${req.user._id} failed because the bookmark does not exist.`,
            );
          }
        } else {
          if (bool) {
            logger.warn(
              `Adding the bookmark for ${page._id} by ${req.user._id} failed because the bookmark has already exist.`,
            );
          } else {
            bookmark = await prisma.bookmarks.removeBookmark(
              page._id,
              req.user._id,
            );
            bookmarkEvent.emit('delete', pageId);
          }
        }
      } catch (err) {
        logger.error('update-bookmark-failed', err);
        return res.apiv3Err(err, 500);
      }

      const parameters = {
        targetModel: SupportedTargetModel.MODEL_PAGE,
        target: page,
        action: bool
          ? SupportedAction.ACTION_PAGE_BOOKMARK
          : SupportedAction.ACTION_PAGE_UNBOOKMARK,
      };

      activityEvent.emit(
        'update',
        res.locals.activity._id,
        parameters,
        page,
        preNotifyService.generatePreNotify,
      );

      return res.apiv3({
        bookmark: bookmark
          ? {
              ...bookmark,
              page: bookmark.pageId,
              user: bookmark.userId,
            }
          : null,
      });
    },
  );

  return router;
};
