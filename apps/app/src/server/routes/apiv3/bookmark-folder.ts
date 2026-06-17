import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Router } from 'express';
import express from 'express';
import { body } from 'express-validator';

import type { BookmarkFolderItems } from '~/interfaces/bookmark-info';
import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import {
  BookmarkFolderForbiddenError,
  BookmarkFolderNotFoundError,
  InvalidParentBookmarkFolderError,
} from '~/server/models/errors';
import { serializeBookmarkSecurely } from '~/server/models/serializers/bookmark-serializer';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:bookmark-folder');

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
    body('parent')
      .isMongoId()
      .optional({ nullable: true })
      .custom(async (parent: string) => {
        const parentFolder = await prisma.bookmarkfolders.findUnique({
          where: { id: parent },
        });
        if (parentFolder == null || parentFolder.parentId != null) {
          throw new Error('Maximum folder hierarchy of 2 levels');
        }
      }),
    body('childFolder')
      .optional()
      .isArray()
      .withMessage('Children must be an array'),
    body('bookmarkFolderId')
      .optional()
      .isMongoId()
      .withMessage('Bookark Folder ID must be a valid mongo ID'),
  ],
  bookmarkPage: [
    body('pageId').isMongoId().withMessage('Page ID must be a valid mongo ID'),
    body('folderId')
      .optional({ nullable: true })
      .isMongoId()
      .withMessage('Folder ID must be a valid mongo ID'),
  ],
  bookmark: [
    body('pageId').isMongoId().withMessage('Page ID must be a valid mongo ID'),
    body('status')
      .isBoolean()
      .withMessage('status must be one of true or false'),
  ],
};

export const setup = (crowi: Crowi): Router => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  /**
   * @swagger
   *
   *    /bookmark-folder:
   *      post:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *          - accessTokenHeaderAuth: []
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
  router.post(
    '/',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequiredStrictly,
    validator.bookmarkFolder,
    apiV3FormValidator,
    async (req: CrowiRequest, res: ApiV3Response) => {
      // loginRequiredStrictly guarantees req.user at runtime; guard narrows the type
      if (req.user == null) {
        return res.apiv3Err(
          new ErrorV3(
            'param "user" must be set.',
            'failed_to_create_bookmark_folder',
          ),
        );
      }
      const owner = req.user._id;
      const { name, parent } = req.body;
      const params = {
        name,
        owner,
        parent,
      };

      try {
        const bookmarkFolder =
          await prisma.bookmarkfolders.createByParameters(params);
        logger.debug({ bookmarkFolder }, 'bookmark folder created');
        return res.apiv3({
          bookmarkFolder: {
            ...bookmarkFolder,
            bookmarks: bookmarkFolder.bookmarkIds,
            owner: bookmarkFolder.ownerId,
            parent: bookmarkFolder.parentId,
          },
        });
      } catch (err) {
        logger.error(err);
        if (err instanceof InvalidParentBookmarkFolderError) {
          return res.apiv3Err(
            new ErrorV3(err.message, 'failed_to_create_bookmark_folder'),
          );
        }
        return res.apiv3Err(err, 500);
      }
    },
  );

  /**
   * @swagger
   *
   *    /bookmark-folder/list/{userId}:
   *      get:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *          - accessTokenHeaderAuth: []
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
  router.get(
    '/list/:userId',
    accessTokenParser([SCOPE.READ.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequiredStrictly,
    async (req: CrowiRequest, res: ApiV3Response) => {
      const { userId } = req.params;

      const getBookmarkFolders = async (
        userId: string,
        parentFolderId?: string,
      ) => {
        const folders = await prisma.bookmarkfolders.findMany({
          where: {
            ownerId: userId,
            ...(parentFolderId
              ? { parentId: parentFolderId }
              : { OR: [{ parentId: { isSet: false } }, { parentId: null }] }),
          },
        });

        const returnValue: BookmarkFolderItems[] = [];

        const promises = folders.map(async (folder) => {
          const childFolder = await getBookmarkFolders(userId, folder.id);
          const populatedBookmarks =
            folder.bookmarkIds.length > 0
              ? await prisma.bookmarks.findMany({
                  where: {
                    id: {
                      in: folder.bookmarkIds,
                    },
                  },
                  include: {
                    page: {
                      include: {
                        lastUpdateUser: true,
                      },
                    },
                  },
                })
              : [];
          const bookmarks = populatedBookmarks.map((bookmark) => {
            const serializedBookmark = serializeBookmarkSecurely(bookmark);
            return {
              ...serializedBookmark,
              user: serializedBookmark.userId,
              page: {
                ...serializedBookmark.page,
                creator: serializedBookmark.page.creatorId,
                deleteUser: serializedBookmark.page.deleteUserId,
                parent: serializedBookmark.page.parentId,
                revision: serializedBookmark.page.revisionId,
              },
            };
          });
          return {
            _id: folder.id,
            name: folder.name,
            owner: folder.ownerId,
            bookmarks,
            childFolder,
            parent: folder.parentId,
          };
        });

        const results = (await Promise.all(
          promises,
        )) as unknown as BookmarkFolderItems[];
        returnValue.push(...results);
        return returnValue;
      };

      try {
        const bookmarkFolderItems = await getBookmarkFolders(userId);

        return res.apiv3({ bookmarkFolderItems });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  /**
   * @swagger
   *
   *    /bookmark-folder/{id}:
   *      delete:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *          - accessTokenHeaderAuth: []
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
  router.delete(
    '/:id',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequiredStrictly,
    async (req: CrowiRequest, res: ApiV3Response) => {
      const { id } = req.params;
      // loginRequiredStrictly guarantees req.user at runtime; guard narrows the type
      if (req.user == null) {
        return res.apiv3Err(
          new ErrorV3('param "user" must be set.', 'forbidden'),
          403,
        );
      }
      try {
        const result = await prisma.bookmarkfolders.deleteFolderAndChildren(
          id,
          req.user._id,
        );
        const { deletedCount } = result;
        return res.apiv3({ deletedCount });
      } catch (err) {
        if (err instanceof BookmarkFolderNotFoundError) {
          return res.apiv3Err('bookmark_folder_not_found', 404);
        }
        if (err instanceof BookmarkFolderForbiddenError) {
          return res.apiv3Err('forbidden', 403);
        }
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  /**
   * @swagger
   *
   *    /bookmark-folder:
   *      put:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *          - accessTokenHeaderAuth: []
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
  router.put(
    '/',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequiredStrictly,
    validator.bookmarkFolder,
    async (req: CrowiRequest, res: ApiV3Response) => {
      const { bookmarkFolderId, name, parent, childFolder } = req.body;
      try {
        const bookmarkFolder =
          await prisma.bookmarkfolders.updateBookmarkFolder(
            bookmarkFolderId,
            name,
            parent,
            childFolder,
          );
        return res.apiv3({
          bookmarkFolder: {
            ...bookmarkFolder,
            bookmarks: bookmarkFolder.bookmarkIds,
            owner: bookmarkFolder.ownerId,
            parent: bookmarkFolder.parentId,
          },
        });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  /**
   * @swagger
   *
   *    /bookmark-folder/add-bookmark-to-folder:
   *      post:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *          - accessTokenHeaderAuth: []
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
  router.post(
    '/add-bookmark-to-folder',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequiredStrictly,
    validator.bookmarkPage,
    apiV3FormValidator,
    async (req: CrowiRequest, res: ApiV3Response) => {
      // loginRequiredStrictly guarantees req.user at runtime; guard narrows the type
      if (req.user == null) {
        return res.apiv3Err(
          new ErrorV3('param "user" must be set.', 'forbidden'),
          403,
        );
      }
      const userId = req.user._id.toString();
      const { pageId, folderId } = req.body;

      try {
        const bookmarkFolder =
          await prisma.bookmarkfolders.insertOrUpdateBookmarkedPage(
            pageId,
            userId,
            folderId,
          );
        logger.debug({ bookmarkFolder }, 'bookmark added to folder');
        return res.apiv3({
          bookmarkFolder: bookmarkFolder
            ? {
                ...bookmarkFolder,
                bookmarks: bookmarkFolder.bookmarkIds,
                owner: bookmarkFolder.ownerId,
                parent: bookmarkFolder.parentId,
              }
            : null,
        });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  /**
   * @swagger
   *
   *    /bookmark-folder/update-bookmark:
   *      put:
   *        tags: [BookmarkFolders]
   *        security:
   *          - bearer: []
   *          - accessTokenInQuery: []
   *          - accessTokenHeaderAuth: []
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
  router.put(
    '/update-bookmark',
    accessTokenParser([SCOPE.WRITE.FEATURES.BOOKMARK], { acceptLegacy: true }),
    loginRequiredStrictly,
    validator.bookmark,
    async (req: CrowiRequest, res: ApiV3Response) => {
      const { pageId, status } = req.body;
      // loginRequiredStrictly guarantees req.user at runtime; guard narrows the type
      if (req.user == null) {
        return res.apiv3Err(
          new ErrorV3('param "user" must be set.', 'forbidden'),
          403,
        );
      }
      const userId = req.user._id.toString();
      try {
        const bookmarkFolder = await prisma.bookmarkfolders.updateBookmark(
          pageId,
          status,
          userId,
        );
        return res.apiv3({
          bookmarkFolder: bookmarkFolder
            ? {
                ...bookmarkFolder,
                bookmarks: bookmarkFolder.bookmarkIds,
                owner: bookmarkFolder.ownerId,
                parent: bookmarkFolder.parentId,
              }
            : null,
        });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err, 500);
      }
    },
  );
  return router;
};
