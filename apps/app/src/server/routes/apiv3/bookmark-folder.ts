import { ErrorV3 } from '@growi/core/dist/models';
import { body } from 'express-validator';
import type { Types } from 'mongoose';

import type { BookmarkFolderItems } from '~/interfaces/bookmark-info';
import { SCOPE } from '@growi/core/dist/interfaces';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { InvalidParentBookmarkFolderError } from '~/server/models/errors';
import { serializeBookmarkSecurely } from '~/server/models/serializers/bookmark-serializer';
import loggerFactory from '~/utils/logger';

import BookmarkFolder from '../../models/bookmark-folder';

const logger = loggerFactory('growi:routes:apiv3:bookmark-folder');
const express = require('express');

const router = express.Router();

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      BookmarkFolder:
 *        description: Bookmark Folder
 *        type: object
 *        properties:
 *          _id:
 *            type: string
 *            description: Bookmark Folder ID
 *          __v:
 *            type: number
 *            description: Version of the bookmark folder
 *          name:
 *            type: string
 *            description: Name of the bookmark folder
 *          owner:
 *            type: string
 *            description: Owner user ID of the bookmark folder
 *          bookmarks:
 *            type: array
 *            items:
 *              type: object
 *              properties:
 *                _id:
 *                  type: string
 *                  description: Bookmark ID
 *                user:
 *                  type: string
 *                  description: User ID of the bookmarker
 *                createdAt:
 *                  type: string
 *                  description: Date and time when the bookmark was created
 *                __v:
 *                  type: number
 *                  description: Version of the bookmark
 *                page:
 *                  description: Pages that are bookmarked in the folder
 *                  allOf:
 *                    - $ref: '#/components/schemas/Page'
 *                    - type: object
 *                      properties:
 *                        id:
 *                          type: string
 *                          description: Page ID
 *                          example: "671b5cd38d45e62b52217ff8"
 *                        parent:
 *                          type: string
 *                          description: Parent page ID
 *                          example: 669a5aa48d45e62b521d00da
 *                        descendantCount:
 *                          type: number
 *                          description: Number of descendants
 *                          example: 0
 *                        isEmpty:
 *                          type: boolean
 *                          description: Whether the page is empty
 *                          example: false
 *                        grantedGroups:
 *                          type: array
 *                          description: List of granted groups
 *                          items:
 *                            type: string
 *                        creator:
 *                          type: string
 *                          description: Creator user ID
 *                          example: "669a5aa48d45e62b521d00e4"
 *                        latestRevisionBodyLength:
 *                          type: number
 *                          description: Length of the latest revision body
 *                          example: 241
 *          childFolder:
 *            type: array
 *            items:
 *              type: object
 *              $ref: '#/components/schemas/BookmarkFolder'
 */
const validator = {
  bookmarkFolder: [
    body('name').isString().withMessage('name must be a string'),
    body('parent').isMongoId().optional({ nullable: true })
      .custom(async(parent: string) => {
        const parentFolder = await BookmarkFolder.findById(parent);
        if (parentFolder == null || parentFolder.parent != null) {
          throw new Error('Maximum folder hierarchy of 2 levels');
        }
      }),
    body('childFolder').optional().isArray().withMessage('Children must be an array'),
    body('bookmarkFolderId').optional().isMongoId().withMessage('Bookark Folder ID must be a valid mongo ID'),
  ],
  bookmarkPage: [
    body('pageId').isMongoId().withMessage('Page ID must be a valid mongo ID'),
    body('folderId').optional({ nullable: true }).isMongoId().withMessage('Folder ID must be a valid mongo ID'),
  ],
  bookmark: [
    body('pageId').isMongoId().withMessage('Page ID must be a valid mongo ID'),
    body('status').isBoolean().withMessage('status must be one of true or false'),
  ],
};

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../middlewares/login-required')(crowi);

  /**
   * @swagger
   *
   *    /bookmark-folder:
   *      post:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *        summary: Create bookmark folder
   *        description: Create a new bookmark folder
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  name:
   *                    type: string
   *                    description: Name of the bookmark folder
   *                    nullable: false
   *                  parent:
   *                    type: string
   *                    description: Parent folder ID
   *        responses:
   *          200:
   *            description: Resources are available
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    bookmarkFolder:
   *                      type: object
   *                      $ref: '#/components/schemas/BookmarkFolder'
   */
  router.post('/',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequiredStrictly, validator.bookmarkFolder, apiV3FormValidator, async(req, res) => {
      const owner = req.user?._id;
      const { name, parent } = req.body;
      const params = {
        name, owner, parent,
      };

      try {
        const bookmarkFolder = await BookmarkFolder.createByParameters(params);
        logger.debug('bookmark folder created', bookmarkFolder);
        return res.apiv3({ bookmarkFolder });
      }
      catch (err) {
        logger.error(err);
        if (err instanceof InvalidParentBookmarkFolderError) {
          return res.apiv3Err(new ErrorV3(err.message, 'failed_to_create_bookmark_folder'));
        }
        return res.apiv3Err(err, 500);
      }
    });

  /**
   * @swagger
   *
   *    /bookmark-folder/list/{userId}:
   *      get:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *        summary: List bookmark folders of a user
   *        description: List bookmark folders of a user
   *        parameters:
   *         - name: userId
   *           in: path
   *           required: true
   *           description: User ID
   *           schema:
   *             type: string
   *        responses:
   *          200:
   *            description: Resources are available
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    bookmarkFolderItems:
   *                      type: array
   *                      items:
   *                        type: object
   *                        $ref: '#/components/schemas/BookmarkFolder'
   */
  router.get('/list/:userId', accessTokenParser([SCOPE.READ.FEATURES.BOOKMARK], { acceptLegacy: true }), loginRequiredStrictly, async(req, res) => {
    const { userId } = req.params;

    const getBookmarkFolders = async(
        userId: Types.ObjectId | string,
        parentFolderId?: Types.ObjectId | string,
    ) => {
      const folders = await BookmarkFolder.find({ owner: userId, parent: parentFolderId })
        .populate('childFolder')
        .populate({
          path: 'bookmarks',
          model: 'Bookmark',
          populate: {
            path: 'page',
            model: 'Page',
            populate: {
              path: 'lastUpdateUser',
              model: 'User',
            },
          },
        }).exec() as never as BookmarkFolderItems[];

      const returnValue: BookmarkFolderItems[] = [];

      const promises = folders.map(async(folder: BookmarkFolderItems) => {
        const childFolder = await getBookmarkFolders(userId, folder._id);

        // !! DO NOT THIS SERIALIZING OUTSIDE OF PROMISES !! -- 05.23.2023 ryoji-s
        // Serializing outside of promises will cause not populated.
        const bookmarks = folder.bookmarks.map(bookmark => serializeBookmarkSecurely(bookmark));

        const res = {
          _id: folder._id.toString(),
          name: folder.name,
          owner: folder.owner,
          bookmarks,
          childFolder,
          parent: folder.parent,
        };
        return res;
      });

      const results = await Promise.all(promises) as unknown as BookmarkFolderItems[];
      returnValue.push(...results);
      return returnValue;
    };

    try {
      const bookmarkFolderItems = await getBookmarkFolders(userId, undefined);

      return res.apiv3({ bookmarkFolderItems });
    }
    catch (err) {
      logger.error(err);
      return res.apiv3Err(err, 500);
    }
  });

  /**
   * @swagger
   *
   *    /bookmark-folder/{id}:
   *      delete:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *        summary: Delete bookmark folder
   *        description: Delete a bookmark folder and its children
   *        parameters:
   *         - name: id
   *           in: path
   *           required: true
   *           description: Bookmark Folder ID
   *           schema:
   *             type: string
   *        responses:
   *          200:
   *            description: Deleted successfully
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    deletedCount:
   *                      type: number
   *                      description: Number of deleted folders
   *                      example: 1
   */
  router.delete('/:id', accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }), loginRequiredStrictly, async(req, res) => {
    const { id } = req.params;
    try {
      const result = await BookmarkFolder.deleteFolderAndChildren(id);
      const { deletedCount } = result;
      return res.apiv3({ deletedCount });
    }
    catch (err) {
      logger.error(err);
      return res.apiv3Err(err, 500);
    }
  });

  /**
   * @swagger
   *
   *    /bookmark-folder:
   *      put:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *        summary: Update bookmark folder
   *        description: Update a bookmark folder
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  bookmarkFolderId:
   *                    type: string
   *                    description: Bookmark Folder ID
   *                  name:
   *                    type: string
   *                    description: Name of the bookmark folder
   *                    nullable: false
   *                  parent:
   *                    type: string
   *                    description: Parent folder ID
   *                  childFolder:
   *                    type: array
   *                    description: Child folders
   *                    items:
   *                      type: object
   *                      $ref: '#/components/schemas/BookmarkFolder'
   *        responses:
   *          200:
   *            description: Resources are available
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    bookmarkFolder:
   *                      type: object
   *                      $ref: '#/components/schemas/BookmarkFolder'
   */
  router.put('/',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }), loginRequiredStrictly, validator.bookmarkFolder, async(req, res) => {
      const {
        bookmarkFolderId, name, parent, childFolder,
      } = req.body;
      try {
        const bookmarkFolder = await BookmarkFolder.updateBookmarkFolder(bookmarkFolderId, name, parent, childFolder);
        return res.apiv3({ bookmarkFolder });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    });

  /**
   * @swagger
   *
   *    /bookmark-folder/add-bookmark-to-folder:
   *      post:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *        summary: Update bookmark folder
   *        description: Update a bookmark folder
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  pageId:
   *                    type: string
   *                    description: Page ID
   *                    nullable: false
   *                  folderId:
   *                    type: string
   *                    description: Folder ID
   *                    nullable: true
   *        responses:
   *          200:
   *            description: Resources are available
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    bookmarkFolder:
   *                      type: object
   *                      $ref: '#/components/schemas/BookmarkFolder'
   */
  router.post('/add-bookmark-to-folder',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }), loginRequiredStrictly, validator.bookmarkPage, apiV3FormValidator,
    async(req, res) => {
      const userId = req.user?._id;
      const { pageId, folderId } = req.body;

      try {
        const bookmarkFolder = await BookmarkFolder.insertOrUpdateBookmarkedPage(pageId, userId, folderId);
        logger.debug('bookmark added to folder', bookmarkFolder);
        return res.apiv3({ bookmarkFolder });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    });

  /**
   * @swagger
   *
   *    /bookmark-folder/update-bookmark:
   *      put:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *        summary: Update bookmark in folder
   *        description: Update a bookmark in a folder
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  pageId:
   *                    type: string
   *                    description: Page ID
   *                    nullable: false
   *                  status:
   *                    type: string
   *                    description: Bookmark status
   *        responses:
   *          200:
   *            description: Resources are available
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    bookmarkFolder:
   *                      type: object
   *                      $ref: '#/components/schemas/BookmarkFolder'
   */
  router.put('/update-bookmark',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }), loginRequiredStrictly, validator.bookmark, async(req, res) => {
      const { pageId, status } = req.body;
      const userId = req.user?._id;
      try {
        const bookmarkFolder = await BookmarkFolder.updateBookmark(pageId, status, userId);
        return res.apiv3({ bookmarkFolder });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    });
  return router;
};
