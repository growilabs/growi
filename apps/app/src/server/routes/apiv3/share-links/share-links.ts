import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Request, Router } from 'express';
import express from 'express';
import { body, param, query, type ValidationChain } from 'express-validator';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import adminRequiredFactory from '~/server/middlewares/admin-required';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from '../interfaces/apiv3-response';
import { expiredAtValidator } from './expired-at-validator';

type AuthorizedRequest<
  TParams = Record<string, string>,
  TQuery = Record<string, never>,
  TBody = unknown,
> = Request<TParams, unknown, TBody, TQuery> & {
  user: IUserHasId;
};

interface CreateShareLinkBody {
  relatedPage: string;
  expiredAt?: string;
  description?: string;
}

const logger = loggerFactory('growi:routes:apiv3:share-links');

const router = express.Router();

const validator: Record<string, ValidationChain[]> = {};

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     ShareLink:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The unique identifier of the share link
 *         relatedPage:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *               description: The unique identifier of the related page
 *             path:
 *               type: string
 *               description: The path of the related page
 *         expiredAt:
 *           type: string
 *           format: date-time
 *           description: The expiration date of the share link
 *         description:
 *           type: string
 *           description: The description of the share link
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The creation date of the share link
 *         __v:
 *           type: integer
 *           description: The version key
 *     ShareLinkSimple:
 *       type: object
 *       properties:
 *         relatedPage:
 *           type: string
 *           description: The unique identifier of the related page
 *         expiredAt:
 *           type: string
 *           format: date-time
 *           description: The expiration date of the share link
 *         description:
 *           type: string
 *           description: The description of the share link
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: The creation date of the share link
 *         __v:
 *           type: integer
 *           description: The version key
 *         _id:
 *           type: string
 *           description: The unique identifier of the share link
 */

export const setup = (crowi: Crowi): Router => {
  const loginRequired = loginRequiredFactory(crowi);
  const adminRequired = adminRequiredFactory(crowi);
  const addActivity = generateAddActivityMiddleware();

  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );

  const activityEvent = crowi.events.activity;

  /**
   * middleware to limit link sharing
   */
  const linkSharingRequired = (
    _req: Request,
    res: ApiV3Response,
    next: NextFunction,
  ) => {
    const isLinkSharingDisabled = crowi.configManager.getConfig(
      'security:disableLinkSharing',
    );
    logger.debug(`isLinkSharingDisabled: ${isLinkSharingDisabled}`);

    if (isLinkSharingDisabled) {
      return res.apiv3Err(
        new ErrorV3('Link sharing is disabled', 'link-sharing-disabled'),
      );
    }
    next();
  };

  validator.getShareLinks = [
    // validate the page id is MongoId
    query('relatedPage').isMongoId().withMessage('Page Id is required'),
  ];

  /**
   * @swagger
   *
   *  paths:
   *    /share-links/:
   *      get:
   *        tags: [ShareLinks]
   *        security:
   *          - cookieAuth: []
   *        description: get share links
   *        parameters:
   *          - name: relatedPage
   *            in: query
   *            required: true
   *            description: page id of share link
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Succeeded to get share links
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    shareLinksResult:
   *                      type: array
   *                      items:
   *                        $ref: '#/components/schemas/ShareLink'
   */
  router.get(
    '/',
    accessTokenParser([SCOPE.READ.FEATURES.SHARE_LINK]),
    loginRequired,
    linkSharingRequired,
    validator.getShareLinks,
    apiV3FormValidator,
    async (
      req: AuthorizedRequest<Record<string, string>, { relatedPage: string }>,
      res: ApiV3Response,
    ) => {
      const { relatedPage } = req.query;

      const page = await Page.findByIdAndViewer(relatedPage, req.user);

      if (page == null) {
        const msg = 'Page is not found or forbidden';
        logger.error(msg);
        return res.apiv3Err(new ErrorV3(msg, 'get-shareLink-failed'));
      }

      try {
        const shareLinksResult = await prisma.sharelinks.findMany({
          where: { relatedPageId: relatedPage },
          include: {
            relatedPage: {
              select: {
                id: true,
                // result-extension field added in utils/prisma.ts; absent from the select type
                // @ts-expect-error
                _id: true,
                path: true,
              },
            },
          },
        });
        return res.apiv3({ shareLinksResult });
      } catch (err) {
        const msg = 'Error occurred in get share link';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'get-shareLink-failed'));
      }
    },
  );

  validator.shareLinkStatus = [
    // validate the page id is MongoId
    body('relatedPage').isMongoId().withMessage('Page Id is required'),
    // validate expireation date is not empty, is not before today and is date.
    expiredAtValidator(),
    // validate the length of description is max 100.
    body('description')
      .isLength({ min: 0, max: 100 })
      .withMessage('Max length is 100'),
  ];

  /**
   * @swagger
   *
   *  paths:
   *    /share-links/:
   *      post:
   *        tags: [ShareLinks]
   *        security:
   *          - cookieAuth: []
   *        description: Create new share link
   *        requestBody:
   *          content:
   *            application/json:
   *              schema:
   *                required:
   *                  - relatedPage
   *                properties:
   *                  relatedPage:
   *                    description: page id of share link
   *                    type: string
   *                  expiredAt:
   *                    description: expiration date of share link
   *                    type: string
   *                  description:
   *                    description: description of share link
   *                    type: string
   *        responses:
   *          200:
   *            description: Succeeded to create one share link
   *            content:
   *              application/json:
   *                schema:
   *                 $ref: '#/components/schemas/ShareLinkSimple'
   */
  router.post(
    '/',
    accessTokenParser([SCOPE.WRITE.FEATURES.SHARE_LINK]),
    loginRequired,
    excludeReadOnlyUser,
    linkSharingRequired,
    addActivity,
    validator.shareLinkStatus,
    apiV3FormValidator,
    async (
      req: AuthorizedRequest<
        Record<string, string>,
        Record<string, never>,
        CreateShareLinkBody
      >,
      res: ApiV3Response,
    ) => {
      const { relatedPage, expiredAt, description } = req.body;

      const page = await Page.findByIdAndViewer(relatedPage, req.user);

      if (page == null) {
        const msg = 'Page is not found or forbidden';
        logger.error(msg);
        return res.apiv3Err(new ErrorV3(msg, 'post-shareLink-failed'));
      }

      try {
        const postedShareLink = await prisma.sharelinks.create({
          data: {
            relatedPageId: relatedPage,
            expiredAt,
            description,
          },
        });

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_SHARE_LINK_CREATE,
        });

        return res.apiv3(
          {
            ...postedShareLink,
            relatedPage: postedShareLink.relatedPageId,
          },
          201,
        );
      } catch (err) {
        const msg = 'Error occured in post share link';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'post-shareLink-failed'));
      }
    },
  );

  validator.deleteShareLinks = [
    // validate the page id is MongoId
    query('relatedPage').isMongoId().withMessage('Page Id is required'),
  ];

  /**
   * @swagger
   *
   *    /share-links/:
   *      delete:
   *        tags: [ShareLinks]
   *        security:
   *          - cookieAuth: []
   *        summary: delete all share links related one page
   *        description: delete all share links related one page
   *        parameters:
   *          - name: relatedPage
   *            in: query
   *            required: true
   *            description: page id of share link
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Succeeded to delete o all share links related one page
   *            content:
   *              application/json:
   *                schema:
   *                 $ref: '#/components/schemas/ShareLinkSimple'
   */
  router.delete(
    '/',
    accessTokenParser([SCOPE.WRITE.FEATURES.SHARE_LINK]),
    loginRequired,
    excludeReadOnlyUser,
    addActivity,
    validator.deleteShareLinks,
    apiV3FormValidator,
    async (
      req: AuthorizedRequest<Record<string, string>, { relatedPage: string }>,
      res: ApiV3Response,
    ) => {
      const { relatedPage } = req.query;
      const page = await Page.findByIdAndViewer(relatedPage, req.user);

      if (page == null) {
        const msg = 'Page is not found or forbidden';
        logger.error(msg);
        return res.apiv3Err(
          new ErrorV3(msg, 'delete-shareLinks-for-page-failed'),
        );
      }

      try {
        const deletedShareLink = await prisma.sharelinks.deleteMany({
          where: { relatedPageId: relatedPage },
        });

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_SHARE_LINK_DELETE_BY_PAGE,
        });

        return res.apiv3({
          // for mongoose compatibility, return acknowledged and deletedCount
          acknowledged: true,
          deletedCount: deletedShareLink.count,
        });
      } catch (err) {
        const msg = 'Error occured in delete share link';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'delete-shareLink-failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /share-links/all:
   *      delete:
   *        tags: [ShareLink Management]
   *        security:
   *         - cookieAuth: []
   *        summary: delete all share links
   *        description: delete all share links
   *        responses:
   *          200:
   *            description: Succeeded to remove all share links
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    deletedCount:
   *                      type: integer
   *                      description: The number of share links deleted
   */
  router.delete(
    '/all',
    accessTokenParser([SCOPE.WRITE.FEATURES.SHARE_LINK]),
    loginRequired,
    adminRequired,
    addActivity,
    async (_req: AuthorizedRequest, res: ApiV3Response) => {
      try {
        const deletedShareLink = await prisma.sharelinks.deleteMany({});
        const deletedCount = deletedShareLink.count;

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_SHARE_LINK_ALL_DELETE,
        });

        return res.apiv3({ deletedCount });
      } catch (err) {
        const msg = 'Error occurred in delete all share link';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'delete-all-shareLink-failed'));
      }
    },
  );

  validator.deleteShareLink = [
    param('id').isMongoId().withMessage('ShareLink Id is required'),
  ];

  /**
   * @swagger
   *
   *    /share-links/{id}:
   *      delete:
   *        tags: [ShareLinks]
   *        security:
   *          - cookieAuth: []
   *        description: delete one share link related one page
   *        parameters:
   *          - name: id
   *            in: path
   *            required: true
   *            description: id of share link
   *            schema:
   *              type: string
   *        responses:
   *          200:
   *            description: Succeeded to delete one share link
   */
  router.delete(
    '/:id',
    accessTokenParser([SCOPE.WRITE.FEATURES.SHARE_LINK]),
    loginRequired,
    excludeReadOnlyUser,
    addActivity,
    validator.deleteShareLink,
    apiV3FormValidator,
    async (req: AuthorizedRequest<{ id: string }>, res: ApiV3Response) => {
      const { id } = req.params;
      const { user } = req;

      try {
        const shareLinkToDelete = await prisma.sharelinks.findUnique({
          where: { id },
        });

        // A nonexistent share-link id must answer the same way as an
        // existing one whose related page cannot be resolved below —
        // otherwise the two are distinguishable (400 vs 404) to a
        // non-admin caller enumerating ids. See
        // apps/app/.claude/rules/page-write-action-403-404.md.
        if (shareLinkToDelete == null) {
          return res.apiv3Err(
            new ErrorV3(
              'Page is not found or forbidden',
              'delete-shareLink-failed',
            ),
            404,
          );
        }

        // check permission
        if (!user.admin) {
          const page = await Page.findByIdAndViewer(
            shareLinkToDelete.relatedPageId,
            user,
          );
          // Deny whenever the related page cannot be resolved for this viewer
          // — regardless of whether that is because it no longer exists or
          // because the user cannot read it. The two must be
          // indistinguishable to a non-admin caller (see
          // apps/app/.claude/rules/page-write-action-403-404.md). Checking
          // only the "forbidden" case here previously let any logged-in
          // non-admin delete a share link whose page had already been
          // deleted.
          if (page == null) {
            const msg = 'Page is not found or forbidden';
            logger.error(msg);
            return res.apiv3Err(
              new ErrorV3(msg, 'delete-shareLink-failed'),
              404,
            );
          }
        }

        // remove
        await prisma.sharelinks.delete({ where: { id } });

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_SHARE_LINK_DELETE,
        });

        return res.apiv3({
          deletedShareLink: {
            ...shareLinkToDelete,
            relatedPage: shareLinkToDelete.relatedPageId,
          },
        });
      } catch (err) {
        const msg = 'Error occurred in delete share link';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'delete-shareLink-failed'));
      }
    },
  );

  return router;
};
