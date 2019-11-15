/* eslint-disable no-unused-vars */
const loggerFactory = require('@alias/logger');

const logger = loggerFactory('growi:routes:apiv3:user-group');

const express = require('express');

const router = express.Router();

const { body } = require('express-validator/check');
const ErrorV3 = require('../../models/vo/error-apiv3');

const validator = {};

/**
 * @swagger
 *  tags:
 *    name: CustomizeSetting
 */

module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../middleware/login-required')(crowi);
  const adminRequired = require('../../middleware/admin-required')(crowi);
  const csrf = require('../../middleware/csrf')(crowi);

  const { ApiV3FormValidator } = crowi.middlewares;

  validator.layoutTheme = [
    body('layoutType').isString(),
    body('themeType').isString(),
  ];

  /**
   * @swagger
   *
   *    /customize-setting/layoutTheme:
   *      put:
   *        tags: [CustomizeSetting]
   *        description: Update layout and theme
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schama:
   *                type: object
   *                properties:
   *                  layoutType:
   *                    description: type of layout
   *                    type: string
   *                  themeType:
   *                    description: type of theme
   *                    type: string
   *      responses:
   *          200:
   *            description: Succeeded to update layout and theme
   */
  router.put('/layoutTheme', loginRequiredStrictly, adminRequired, csrf, validator.layoutTheme, ApiV3FormValidator, async(req, res) => {
    const requestParams = {
      'customize:layout': req.body.layoutType,
      'customize:theme': req.body.themeType,
    };

    try {
      await crowi.configManager.updateConfigsInTheSameNamespace('crowi', requestParams);
      const customizedParams = {
        layoutType: await crowi.configManager.getConfig('crowi', 'customize:layout'),
        themeType: await crowi.configManager.getConfig('crowi', 'customize:theme'),
      };
      return res.apiv3({ customizedParams });
    }
    catch (err) {
      const msg = 'Error occurred in updating layout and theme';
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(msg, 'update-layoutTheme-failed'));
    }
  });

  validator.customizeTitle = [
    // body('').isString(),
  ];

  /**
   * @swagger
   *
   *    /customize-setting/customizeTitle:
   *      put:
   *        tags: [CustomizeSetting]
   *        description: Update customizeTitle
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                type: object
   *                properties:
   *                  title:
   *                    description: customized title
   *                    type: string
   *      responses:
   *          200:
   *            description: Succeeded to update customizeTitle
   */
  router.put('/customizeTitle', loginRequiredStrictly, adminRequired, csrf, validator.customizeTitle, ApiV3FormValidator, async(req, res) => {
    const requestParams = {
      'customize:title': req.body.customizeTitle,
    };

    try {
      await crowi.configManager.updateConfigsInTheSameNamespace('crowi', requestParams);
      const customizedParams = {
        title: await crowi.configManager.getConfig('crowi', 'customize:title'),
      };
      return res.apiv3({ customizedParams });
    }
    catch (err) {
      const msg = 'Error occurred in updating customizeTitle';
      logger.error('Error', err);
      return res.apiv3Err(new ErrorV3(msg, 'update-customizeTitle-failed'));
    }
  });

  return router;
};
