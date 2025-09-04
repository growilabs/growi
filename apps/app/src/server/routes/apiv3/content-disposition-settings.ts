import { ErrorV3 } from '@growi/core/dist/models';
import { body, param } from 'express-validator';

import { SupportedAction } from '~/interfaces/activity';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:content-disposition-settings');
const express = require('express');

const router = express.Router();

const validator = {
  updateContentDisposition: [
    param('mimeType')
      .exists()
      .notEmpty()
      .withMessage('MIME type is required')
      .bail()
      .matches(/^.+\/.+$/)
      .custom((value) => {
        const mimeTypeDefaults = configManager.getConfig('attachments:contentDisposition:mimeTypeOverrides');
        return Object.keys(mimeTypeDefaults).includes(value);
      })
      .withMessage('Invalid or unconfigurable MIME type specified.'),

    body('disposition')
      .isIn(['inline', 'attachment'])
      .withMessage('`disposition` must be either "inline" or "attachment".'),
  ],
};

/*
 * @swagger
 *
 *  components:
 *    schemas:
 *    parameters:
 *      - $ref: '#/components/parameters/MimeTypePathParam'
  */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);
  const adminRequired = require('~/server/middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware();
  const activityEvent = crowi.event('activity');

  /**
 * @swagger
 *
 * /content-disposition-settings:
 *   get:
 *     tags: [Content-Disposition Settings]
 *     summary: Get content disposition settings for configurable MIME types
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved content disposition settings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 contentDispositionSettings:
 *                   type: object
 *                   additionalProperties:
 *                     type: string
 *                     description: inline or attachment
 *
 */
  router.get('/', loginRequiredStrictly, adminRequired, async(req, res) => {
    try {

      const mimeTypeDefaults = configManager.getConfig('attachments:contentDisposition:mimeTypeOverrides');
      const contentDispositionSettings: Record<string, 'inline' | 'attachment'> = mimeTypeDefaults;

      return res.apiv3({ contentDispositionSettings });
    }
    catch (err) {
      logger.error('Error retrieving content disposition settings:', err);
      return res.apiv3Err(new ErrorV3('Failed to retrieve content disposition settings', 'get-content-disposition-failed'));
    }
  });

  router.put(
    '/strict',
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    async(req, res) => {

      try {
        const strictMimeTypeSettings: Record<string, 'inline' | 'attachment'> = {
          'application/pdf': 'attachment',
          'application/json': 'attachment',
          'text/csv': 'attachment',
          'font/woff2': 'attachment',
          'font/woff': 'attachment',
          'font/ttf': 'attachment',
          'font/otf': 'attachment',
        };

        await configManager.updateConfigs({ 'attachments:contentDisposition:mimeTypeOverrides': strictMimeTypeSettings });

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_ATTACHMENT_DISPOSITION_UPDATE,
          contentDispositionSettings: strictMimeTypeSettings,
          currentMode: 'strict',
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ currentMode: 'strict', contentDispositionSettings: strictMimeTypeSettings });
      }
      catch (err) {
        const msg = 'Error occurred in updating content disposition for MIME types';
        logger.error(msg, err);
        return res.apiv3Err(
          new ErrorV3(msg, 'update-content-disposition-failed'),
        );
      }
    },
  );

  router.put(
    '/lax',
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    async(req, res) => {

      try {
        const laxMimeTypeSettings: Record<string, 'inline' | 'attachment'> = {
          'application/pdf': 'inline',
          'application/json': 'inline',
          'text/csv': 'inline',
          'font/woff2': 'inline',
          'font/woff': 'inline',
          'font/ttf': 'inline',
          'font/otf': 'inline',
        };

        await configManager.updateConfigs({ 'attachments:contentDisposition:mimeTypeOverrides': laxMimeTypeSettings });

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_ATTACHMENT_DISPOSITION_UPDATE,
          contentDispositionSettings: laxMimeTypeSettings,
          currentMode: 'lax',
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ currentMode: 'lax', contentDispositionSettings: laxMimeTypeSettings });
      }
      catch (err) {
        const msg = 'Error occurred in updating content disposition for MIME types';
        logger.error(msg, err);
        return res.apiv3Err(
          new ErrorV3(msg, 'update-content-disposition-failed'),
        );
      }
    },
  );


  /**
 * @swagger
 *
 * paths:
 *    /content-disposition-settings/{mimeType}:
 *      put:
 *        tags: [Content Disposition Settings]
 *        summary: Update content disposition setting for a specific MIME type
 *        security:
 *          - cookieAuth: []
 *        parameters:
 *          - $ref: '#/components/parameters/MimeTypePathParam'
 *        requestBody:
 *          required: true
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                required:
 *                  - disposition
 *                properties:
 *                  disposition:
 *                     type: string
 *        responses:
 *          200:
 *            description: Successfully updated content disposition setting
 *            content:
 *              application/json:
 *                schema:
 *                  type: object
 *                  properties:
 *                    setting:
 *                       type: object
 *                       properties:
 *                         mimeType:
 *                           type: string
 *                         disposition:
 *                           type: string
 */
  router.put(
    '/:mimeType(*)',
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.updateContentDisposition,
    apiV3FormValidator,
    async(req, res) => {
      const { mimeType } = req.params;
      const { disposition } = req.body;

      try {
        const currentMimeTypeDefaults = configManager.getConfig('attachments:contentDisposition:mimeTypeOverrides');

        const newDisposition: 'inline' | 'attachment' = disposition;

        const updatedMimeTypeDefaults = {
          ...currentMimeTypeDefaults,
          [mimeType]: newDisposition,
        };

        await configManager.updateConfigs({ 'attachments:contentDisposition:mimeTypeOverrides': updatedMimeTypeDefaults });
        const updatedDispositionFromDb = configManager.getConfig('attachments:contentDisposition:mimeTypeOverrides')[mimeType];

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_ATTACHMENT_DISPOSITION_UPDATE,
          mimeType,
          disposition: updatedDispositionFromDb,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ mimeType, disposition: updatedDispositionFromDb });
      }
      catch (err) {
        const msg = `Error occurred in updating content disposition for MIME type: ${mimeType}`;
        logger.error(msg, err);
        return res.apiv3Err(
          new ErrorV3(msg, 'update-content-disposition-failed'),
        );
      }
    },
  );


  return router;
};
