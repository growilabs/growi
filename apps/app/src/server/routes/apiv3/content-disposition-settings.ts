import { ErrorV3 } from '@growi/core/dist/models';

import { SupportedAction } from '~/interfaces/activity';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { configManager } from '~/server/service/config-manager';
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

      const mimeTypeDefaults = configManager.getConfig('attachments:contentDisposition:mimeTypeOverrides');
      const contentDispositionSettings: Record<string, 'inline' | 'attachment'> = mimeTypeDefaults;
      let currentMode: string;

      const strictMimeTypeSettings: Record<string, 'inline' | 'attachment'> = {
        // Documents
        'application/pdf': 'attachment',
        'application/json': 'attachment',
        'text/plain': 'attachment',
        'text/csv': 'attachment',
        'text/html': 'attachment',

        // Images
        'image/jpeg': 'attachment',
        'image/png': 'attachment',
        'image/gif': 'attachment',
        'image/webp': 'attachment',
        'image/svg+xml': 'attachment',

        // Audio and Video
        'audio/mpeg': 'attachment',
        'video/mp4': 'attachment',
        'video/webm': 'attachment',

        // Fonts
        'font/woff2': 'attachment',
        'font/woff': 'attachment',
        'font/ttf': 'attachment',
        'font/otf': 'attachment',
      };

      const laxMimeTypeSettings: Record<string, 'inline' | 'attachment'> = {
        // Documents
        'application/pdf': 'inline',
        'application/json': 'inline',
        'text/plain': 'inline',
        'text/csv': 'inline',
        'text/html': 'attachment',

        // Images
        'image/jpeg': 'inline',
        'image/png': 'inline',
        'image/gif': 'inline',
        'image/webp': 'inline',
        'image/svg+xml': 'attachment',

        // Audio and Video
        'audio/mpeg': 'inline',
        'video/mp4': 'inline',
        'video/webm': 'inline',

        // Fonts
        'font/woff2': 'inline',
        'font/woff': 'inline',
        'font/ttf': 'inline',
        'font/otf': 'inline',
      };

      if (JSON.stringify(contentDispositionSettings) === JSON.stringify(strictMimeTypeSettings)) {
        currentMode = 'strict';
      }

      else if (JSON.stringify(contentDispositionSettings) === JSON.stringify(laxMimeTypeSettings)) {
        currentMode = 'lax';
      }

      else {
        currentMode = 'custom';
      }

      return res.apiv3({ currentMode, contentDispositionSettings });
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
        const strictMimeTypeSettings: Record<string, 'inline' | 'attachment'> = {
          // Documents
          'application/pdf': 'attachment',
          'application/json': 'attachment',
          'text/plain': 'attachment',
          'text/csv': 'attachment',
          'text/html': 'attachment',

          // Images
          'image/jpeg': 'attachment',
          'image/png': 'attachment',
          'image/gif': 'attachment',
          'image/webp': 'attachment',
          'image/svg+xml': 'attachment',

          // Audio and Video
          'audio/mpeg': 'attachment',
          'video/mp4': 'attachment',
          'video/webm': 'attachment',

          // Fonts
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
        const laxMimeTypeSettings: Record<string, 'inline' | 'attachment'> = {
          // Documents
          'application/pdf': 'inline',
          'application/json': 'inline',
          'text/plain': 'inline',
          'text/csv': 'inline',
          'text/html': 'attachment',

          // Images
          'image/jpeg': 'inline',
          'image/png': 'inline',
          'image/gif': 'inline',
          'image/webp': 'inline',
          'image/svg+xml': 'attachment',

          // Audio and Video
          'audio/mpeg': 'inline',
          'video/mp4': 'inline',
          'video/webm': 'inline',

          // Fonts
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

  return router;
};
