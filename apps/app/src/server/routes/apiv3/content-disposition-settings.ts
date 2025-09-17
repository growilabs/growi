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

  interface UpdateMimeTypesPayload {
  newInlineMimeTypes: string[];
  }

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
 *                 currentDispositionSettings:
 *                   type: object
 *                   properties:
 *                     type: array
 *                     description: The list of MIME types set to inline.
 *                       items:
 *                       type: string
 *
 */
  router.put(
    '/update',
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    async(req, res) => {

      try {
        const { newInlineMimeTypes } = req.body as UpdateMimeTypesPayload;
        const inlineMimeTypes = Array.from(new Set(newInlineMimeTypes));
        await configManager.updateConfigs({ 'attachments:contentDisposition:inlineMimeTypes': { inlineMimeTypes } });

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_ATTACHMENT_DISPOSITION_UPDATE,
          currentDispositionSettings: inlineMimeTypes,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({
          currentDispositionSettings: {
            inlineMimeTypes,
          },
        });
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
 *                 currentDispositionSettings:
 *                   type: object
 *                   properties:
 *                     type: array
 *                     description: The list of MIME types set to inline.
 *                       items:
 *                       type: string
 *
 */
  router.get('/', loginRequiredStrictly, adminRequired, async(req, res) => {
    try {
      const currentDispositionSettings = configManager.getConfig('attachments:contentDisposition:inlineMimeTypes');

      return res.apiv3({ currentDispositionSettings });
    }
    catch (err) {
      logger.error('Error retrieving content disposition settings:', err);
      return res.apiv3Err(new ErrorV3('Failed to retrieve content disposition settings', 'get-content-disposition-failed'));
    }
  });

  return router;
};
