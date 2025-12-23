import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';
import { body } from 'express-validator';

import { AllSidebarContentsType } from '~/interfaces/ui';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import UserUISettings from '../../models/user-ui-settings';

const logger = loggerFactory('growi:routes:apiv3:user-ui-settings');

const router = express.Router();

module.exports = () => {
  const validatorForPut = [
    body('settings')
      .exists()
      .withMessage("The body param 'settings' is required"),
    body('settings.currentSidebarContents')
      .optional()
      .isIn(AllSidebarContentsType),
    body('settings.currentProductNavWidth').optional().isNumeric(),
    body('settings.preferCollapsedModeByUser').optional().isBoolean(),
  ];

  /**
   * @swagger
   *
   * /user-ui-settings:
   *   put:
   *     tags: [UserUISettings]
   *     security:
   *       - cookieAuth: []
   *     summary: /user-ui-settings
   *     description: Update the user's UI settings
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               settings:
   *                 type: object
   *                 properties:
   *                   currentSidebarContents:
   *                     type: string
   *                   currentProductNavWidth:
   *                     type: number
   *                   preferCollapsedModeByUser:
   *                     type: boolean
   *     responses:
   *       200:
   *         description: The user's UI settings
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 _id:
   *                   type: string
   *                 user:
   *                   type: string
   *                 __v:
   *                   type: number
   *                 currentSidebarContents:
   *                   type: string
   *                 preferCollapsedModeByUser:
   *                   type: boolean
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router.put(
    '/',
    validatorForPut,
    apiV3FormValidator,
    async (req: any, res: any) => {
      const { user } = req;
      const { settings } = req.body;

      // extract only necessary params
      const updateData = {
        currentSidebarContents: settings.currentSidebarContents,
        currentProductNavWidth: settings.currentProductNavWidth,
        preferCollapsedModeByUser: settings.preferCollapsedModeByUser,
      };

      if (user == null) {
        if (req.session.uiSettings == null) {
          req.session.uiSettings = {};
        }
        Object.keys(updateData).forEach((setting) => {
          if (updateData[setting] != null) {
            req.session.uiSettings[setting] = updateData[setting];
          }
        });
        return res.apiv3(updateData);
      }

      // remove the keys that have null value
      Object.keys(updateData).forEach((key) => {
        if (updateData[key] == null) {
          delete updateData[key];
        }
      });

      try {
        const updatedSettings = await UserUISettings.findOneAndUpdate(
          { user: user._id },
          {
            $set: {
              user: user._id,
              ...updateData,
            },
          },
          { upsert: true, new: true },
        );
        return res.apiv3(updatedSettings);
      } catch (err) {
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(err));
      }
    },
  );

  return router;
};
