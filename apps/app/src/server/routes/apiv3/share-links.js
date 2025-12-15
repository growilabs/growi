// TODO remove this setting after implemented all
/* eslint-disable no-unused-vars */
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';

import { SupportedAction } from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { excludeReadOnlyUser } from '~/server/middlewares/exclude-read-only-user';
import ShareLink from '~/server/models/share-link';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:share-links');

const router = express.Router();

const { body, query, param } = require('express-validator');

const validator = {};

const today = new Date();

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

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequired = require('../../middlewares/login-required')(crowi);
  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const Page = crowi.model('Page');

  const activityEvent = crowi.event('activity');

  /**
   * middleware to limit link sharing
   */
  const linkSharingRequired = (req, res, next) => {
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
    query('relatedPage')
      .isMongoId()
      .withMessage('Page Id is required'),
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
    async (req, res) => {
      const { relatedPage } = req.query;

      const page = await Page.findByIdAndViewer(relatedPage, req.user);

      if (page == null) {
        const msg = 'Page is not found or forbidden';
        logger.error('Error', msg);
        return res.apiv3Err(new ErrorV3(msg, 'get-shareLink-failed'));
      }

      try {
        const shareLinksResult = await ShareLink.find({
          relatedPage: { $eq: relatedPage },
        }).populate({ path: 'relatedPage', select: 'path' });
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
    body('relatedPage')
      .isMongoId()
      .withMessage('Page Id is required'),
    // validate expireation date is not empty, is not before today and is date.
    body('expiredAt')
      .if((value) => value != null)
      .isAfter(today.toString())
      .withMessage('Your Selected date is past'),
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
    async (req, res) => {
      const { relatedPage, expiredAt, description } = req.body;

      const page = await Page.findByIdAndViewer(relatedPage, req.user);

      if (page == null) {
        const msg = 'Page is not found or forbidden';
        logger.error('Error', msg);
        return res.apiv3Err(new ErrorV3(msg, 'post-shareLink-failed'));
      }

      try {
        const postedShareLink = await ShareLink.create({
          relatedPage,
          expiredAt,
          description,
        });

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_SHARE_LINK_CREATE,
        });

        return res.apiv3(postedShareLink, 201);
      } catch (err) {
        const msg = 'Error occured in post share link';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'post-shareLink-failed'));
      }
    },
  );

  validator.deleteShareLinks = [
    // validate the page id is MongoId
    query('relatedPage')
      .isMongoId()
      .withMessage('Page Id is required'),
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
    async (req, res) => {
      const { relatedPage } = req.query;
      const page = await Page.findByIdAndViewer(relatedPage, req.user);

      if (page == null) {
        const msg = 'Page is not found or forbidden';
        logger.error('Error', msg);
        return res.apiv3Err(
          new ErrorV3(msg, 'delete-shareLinks-for-page-failed'),
        );
      }

      try {
        const deletedShareLink = await ShareLink.deleteMany({
          relatedPage: { $eq: relatedPage },
        });

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_SHARE_LINK_DELETE_BY_PAGE,
        });

        return res.apiv3(deletedShareLink);
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
    async (req, res) => {
      try {
        const deletedShareLink = await ShareLink.deleteMany({});
        const { deletedCount } = deletedShareLink;

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
    async (req, res) => {
      const { id } = req.params;
      const { user } = req;

      try {
        const shareLinkToDelete = await ShareLink.findOne({ _id: id });

        // check permission
        if (!user.isAdmin) {
          const page = await Page.findByIdAndViewer(
            shareLinkToDelete.relatedPage,
            user,
          );
          const isPageExists =
            (await Page.count({ _id: shareLinkToDelete.relatedPage })) > 0;
          if (page == null && isPageExists) {
            const msg = 'Page is not found or forbidden';
            logger.error('Error', msg);
            return res.apiv3Err(new ErrorV3(msg, 'delete-shareLink-failed'));
          }
        }

        // remove
        await shareLinkToDelete.remove();

        activityEvent.emit('update', res.locals.activity._id, {
          action: SupportedAction.ACTION_SHARE_LINK_DELETE,
        });

        return res.apiv3({ deletedShareLink: shareLinkToDelete });
      } catch (err) {
        const msg = 'Error occurred in delete share link';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'delete-shareLink-failed'));
      }
    },
  );

  return router;
};
