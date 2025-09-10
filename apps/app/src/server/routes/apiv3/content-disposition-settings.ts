import { ErrorV3 } from '@growi/core/dist/models';

import { SupportedAction } from '~/interfaces/activity';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { configManager } from '~/server/service/config-manager';
import { strictMimeTypeSettings, laxMimeTypeSettings } from '~/server/service/file-uploader/utils/security';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:content-disposition-settings');
const express = require('express');

const router = express.Router();

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
      const currentDispositionSettings = configManager.getConfig('attachments:contentDisposition:mimeTypeOverrides');
      const contentDispositionSettings: Record<string, 'inline' | 'attachment'> = currentDispositionSettings;

      return res.apiv3({ contentDispositionSettings });
    }
    catch (err) {
      logger.error('Error retrieving content disposition settings:', err);
      return res.apiv3Err(new ErrorV3('Failed to retrieve content disposition settings', 'get-content-disposition-failed'));
    }
  });

  /**
 * @swagger
 *
 * /content-disposition-settings/strict:
 *   put:
 *     tags: [Content-Disposition Settings]
 *     summary: Set content disposition settings for configurable MIME types to strict.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Successfully set strict content disposition settings.
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
  router.put(
    '/strict',
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    async(req, res) => {

      try {
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

  /**
 * @swagger
 *
 * /content-disposition-settings/lax:
 *   put:
 *     tags: [Content-Disposition Settings]
 *     summary: Set content disposition settings for configurable MIME types to lax.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Successfully set lax content disposition settings.
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
  router.put(
    '/lax',
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    async(req, res) => {

      try {
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

  return router;
};
