import type { IUserHasId } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request } from 'express';
import { body } from 'express-validator';

import { SupportedAction } from '~/interfaces/activity';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:content-disposition-settings');
const express = require('express');

const router = express.Router();

module.exports = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);
  const adminRequired = require('~/server/middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware();
  const activityEvent = crowi.event('activity');

  const validateUpdateMimeTypes = [
    body('newInlineMimeTypes').exists().withMessage('Inline mime types field is required.').bail(),
    body('newInlineMimeTypes').isArray().withMessage('Inline mime types must be an array.'),

    body('newAttachmentMimeTypes').exists().withMessage('Attachment mime types field is required.').bail(),
    body('newAttachmentMimeTypes').isArray().withMessage('Attachment mime types must be an array.'),
  ];

  interface AuthorizedRequest extends Request {
    user?: IUserHasId;
  }

  interface UpdateMimeTypesBody {
    newInlineMimeTypes: string[];
    newAttachmentMimeTypes: string[];
  }

  interface UpdateMimeTypesRequest extends Request {
    user?: IUserHasId;
    body: UpdateMimeTypesBody;
  }

  /**
 * @swagger
 *
 * /content-disposition-settings/:
 *   put:
 *     tags: [Content-Disposition Settings]
 *     summary: Replace content disposition settings for configurable MIME types with recieved lists.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Successfully set content disposition settings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currentDispositionSettings:
 *                   type: object
 *                   properties:
 *                     inlineMimeTypes:
 *                       type: array
 *                       description: The list of MIME types set to inline.
 *                       items:
 *                         type: string
 *                     attachmentMimeTypes:
 *                       type: array
 *                       description: The list of MIME types set to attachment.
 *                       items:
 *                         type: string
 *
 */
  router.put(
    '/',
    loginRequiredStrictly,
    adminRequired,
    validateUpdateMimeTypes,
    apiV3FormValidator,
    addActivity,

    async(req: UpdateMimeTypesRequest, res: ApiV3Response) => {
      const newInlineMimeTypes: string[] = req.body.newInlineMimeTypes;
      const newAttachmentMimeTypes: string[] = req.body.newAttachmentMimeTypes;

      // Ensure no MIME type is in both lists.
      const inlineSet = new Set(newInlineMimeTypes);
      const attachmentSet = new Set(newAttachmentMimeTypes);
      const intersection = [...inlineSet].filter(mimeType => attachmentSet.has(mimeType));

      if (intersection.length > 0) {
        const msg = `MIME types cannot be in both inline and attachment lists: ${intersection.join(', ')}`;
        return res.apiv3Err(new ErrorV3(msg, 'invalid-payload'));
      }

      try {
        await configManager.updateConfigs({
          'attachments:contentDisposition:inlineMimeTypes': {
            inlineMimeTypes: Array.from(inlineSet),
          },
          'attachments:contentDisposition:attachmentMimeTypes': {
            attachmentMimeTypes: Array.from(attachmentSet),
          },
        });

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_ATTACHMENT_DISPOSITION_UPDATE,
          currentDispositionSettings: {
            inlineMimeTypes: Array.from(inlineSet),
            attachmentMimeTypes: Array.from(attachmentSet),
          },
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({
          currentDispositionSettings: {
            inlineMimeTypes: Array.from(inlineSet),
            attachmentMimeTypes: Array.from(attachmentSet),
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
 *                     inlineMimeTypes:
 *                       type: array
 *                       description: The list of MIME types set to inline.
 *                       items:
 *                         type: string
 *                     attachmentMimeTypes:
 *                       type: array
 *                       description: The list of MIME types set to attachment.
 *                       items:
 *                         type: string
 *
 */
  router.get('/', loginRequiredStrictly, adminRequired, async(req: AuthorizedRequest, res: ApiV3Response) => {
    try {
      const inlineDispositionSettings = configManager.getConfig('attachments:contentDisposition:inlineMimeTypes');
      const attachmentDispositionSettings = configManager.getConfig('attachments:contentDisposition:attachmentMimeTypes');

      return res.apiv3({
        currentDispositionSettings: {
          inlineMimeTypes: inlineDispositionSettings.inlineMimeTypes,
          attachmentMimeTypes: attachmentDispositionSettings.attachmentMimeTypes,
        },
      });
    }
    catch (err) {
      logger.error('Error retrieving content disposition settings:', err);
      return res.apiv3Err(new ErrorV3('Failed to retrieve content disposition settings', 'get-content-disposition-failed'));
    }
  });

  return router;
};
