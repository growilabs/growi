import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';

import { SupportedAction } from '~/interfaces/activity';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';

const logger = loggerFactory('growi:routes:apiv3:markdown-setting');

const express = require('express');

const router = express.Router();

const { body } = require('express-validator');

const validator = {
  lineBreak: [
    body('isEnabledLinebreaks').isBoolean(),
    body('isEnabledLinebreaksInComments').isBoolean(),
  ],
  indent: [
    body('adminPreferredIndentSize').isIn([2, 4]),
    body('isIndentSizeForced').isBoolean(),
  ],
  xssSetting: [
    body('isEnabledXss').isBoolean(),
    body('tagWhitelist').isArray(),
    body('attrWhitelist').isString(),
  ],
};

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      MarkdownParams:
 *        description: MarkdownParams
 *        type: object
 *        properties:
 *          isEnabledLinebreaks:
 *            type: boolean
 *            description: enable lineBreak
 *          isEnabledLinebreaksInComments:
 *            type: boolean
 *            description: enable lineBreak in comment
 *          adminPreferredIndentSize:
 *            type: number
 *            description: preferred indent size
 *          isIndentSizeForced:
 *            type: boolean
 *            description: force indent size
 *          isEnabledXss:
 *            type: boolean
 *            description: enable xss
 *          xssOption:
 *            type: number
 *            description: number of xss option
 *          tagWhitelist:
 *            type: array
 *            description: array of tag whitelist
 *            items:
 *              type: string
 *              description: tag whitelist
 *          attrWhitelist:
 *            type: string
 *            description: attr whitelist
 *      LineBreakParams:
 *        description: LineBreakParams
 *        type: object
 *        properties:
 *          isEnabledLinebreaks:
 *            type: boolean
 *            description: enable lineBreak
 *          isEnabledLinebreaksInComments:
 *            type: boolean
 *            description: enable lineBreak in comment
 *      PresentationParams:
 *        description: PresentationParams
 *        type: object
 *        properties:
 *          pageBreakSeparator:
 *            type: number
 *            description: number of pageBreakSeparator
 *          pageBreakCustomSeparator:
 *            type: string
 *            description: string of pageBreakCustomSeparator
 *      XssParams:
 *        description: XssParams
 *        type: object
 *        properties:
 *          isEnabledXss:
 *            type: boolean
 *            description: enable xss
 *          xssOption:
 *            type: number
 *            description: number of xss option
 *          tagWhitelist:
 *            type: array
 *            description: array of tag whitelist
 *            items:
 *              type: string
 *              description: tag whitelist
 *          attrWhitelist:
 *            type: string
 *            description: attr whitelist
 *      IndentParams:
 *        description: IndentParams
 *        type: object
 *        properties:
 *          adminPreferredIndentSize:
 *            type: number
 *            description: preferred indent size
 *          isIndentSizeForced:
 *            type: boolean
 *            description: force indent size
 */

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../middlewares/login-required')(
    crowi,
  );
  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.event('activity');

  /**
   * @swagger
   *
   *    /markdown-setting:
   *      get:
   *        tags: [MarkDownSetting]
   *        security:
   *          - cookieAuth: []
   *        summary: Get markdown parameters
   *        responses:
   *          200:
   *            description: params of markdown
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    markdownParams:
   *                      type: object
   *                      description: markdown params
   *                      $ref: '#/components/schemas/MarkdownParams'
   */
  router.get(
    '/',
    accessTokenParser([SCOPE.READ.ADMIN.MARKDOWN]),
    loginRequiredStrictly,
    adminRequired,
    async (req, res) => {
      const markdownParams = {
        isEnabledLinebreaks: await crowi.configManager.getConfig(
          'markdown:isEnabledLinebreaks',
        ),
        isEnabledLinebreaksInComments: await crowi.configManager.getConfig(
          'markdown:isEnabledLinebreaksInComments',
        ),
        adminPreferredIndentSize: await crowi.configManager.getConfig(
          'markdown:adminPreferredIndentSize',
        ),
        isIndentSizeForced: await crowi.configManager.getConfig(
          'markdown:isIndentSizeForced',
        ),
        isEnabledXss: await crowi.configManager.getConfig(
          'markdown:rehypeSanitize:isEnabledPrevention',
        ),
        xssOption: await crowi.configManager.getConfig(
          'markdown:rehypeSanitize:option',
        ),
        tagWhitelist: await crowi.configManager.getConfig(
          'markdown:rehypeSanitize:tagNames',
        ),
        attrWhitelist: await crowi.configManager.getConfig(
          'markdown:rehypeSanitize:attributes',
        ),
      };

      return res.apiv3({ markdownParams });
    },
  );

  /**
   * @swagger
   *
   *    /markdown-setting/lineBreak:
   *      put:
   *        tags: [MarkDownSetting]
   *        security:
   *          - cookieAuth: []
   *        summary: Update lineBreak setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/LineBreakParams'
   *        responses:
   *          200:
   *            description: Succeeded to update lineBreak setting
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    lineBreaksParams:
   *                      type: object
   *                      $ref: '#/components/schemas/LineBreakParams'
   */
  router.put(
    '/lineBreak',
    accessTokenParser([SCOPE.WRITE.ADMIN.MARKDOWN]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.lineBreak,
    apiV3FormValidator,
    async (req, res) => {
      const requestLineBreakParams = {
        'markdown:isEnabledLinebreaks': req.body.isEnabledLinebreaks,
        'markdown:isEnabledLinebreaksInComments':
          req.body.isEnabledLinebreaksInComments,
      };

      try {
        await configManager.updateConfigs(requestLineBreakParams);
        const lineBreaksParams = {
          isEnabledLinebreaks: await crowi.configManager.getConfig(
            'markdown:isEnabledLinebreaks',
          ),
          isEnabledLinebreaksInComments: await crowi.configManager.getConfig(
            'markdown:isEnabledLinebreaksInComments',
          ),
        };

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_MARKDOWN_LINE_BREAK_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ lineBreaksParams });
      } catch (err) {
        const msg = 'Error occurred in updating lineBreak';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-lineBreak-failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /markdown-setting/indent:
   *      put:
   *        tags: [MarkDownSetting]
   *        security:
   *          - cookieAuth: []
   *        summary: Update indent setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/IndentParams'
   *        responses:
   *          200:
   *            description: Succeeded to update indent setting
   *            content:
   *              application/json:
   *                schema:
   *                  type: object
   *                  properties:
   *                    indentParams:
   *                      type: object
   *                      description: indent params
   *                      $ref: '#/components/schemas/IndentParams'
   */
  router.put(
    '/indent',
    accessTokenParser([SCOPE.WRITE.ADMIN.MARKDOWN]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.indent,
    apiV3FormValidator,
    async (req, res) => {
      const requestIndentParams = {
        'markdown:adminPreferredIndentSize': req.body.adminPreferredIndentSize,
        'markdown:isIndentSizeForced': req.body.isIndentSizeForced,
      };

      try {
        await configManager.updateConfigs(requestIndentParams);
        const indentParams = {
          adminPreferredIndentSize: await crowi.configManager.getConfig(
            'markdown:adminPreferredIndentSize',
          ),
          isIndentSizeForced: await crowi.configManager.getConfig(
            'markdown:isIndentSizeForced',
          ),
        };

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_MARKDOWN_INDENT_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ indentParams });
      } catch (err) {
        const msg = 'Error occurred in updating indent';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-indent-failed'));
      }
    },
  );

  /**
   * @swagger
   *
   *    /markdown-setting/xss:
   *      put:
   *        tags: [MarkDownSetting]
   *        security:
   *          - cookieAuth: []
   *        summary: Update XSS setting
   *        description: Update xss
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/XssParams'
   *        responses:
   *          200:
   *            description: Succeeded to update xss setting
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/XssParams'
   */
  router.put(
    '/xss',
    accessTokenParser([SCOPE.WRITE.ADMIN.MARKDOWN]),
    loginRequiredStrictly,
    adminRequired,
    addActivity,
    validator.xssSetting,
    apiV3FormValidator,
    async (req, res) => {
      if (req.body.isEnabledXss && req.body.xssOption == null) {
        return res.apiv3Err(new ErrorV3('xss option is required'));
      }

      try {
        JSON.parse(req.body.attrWhitelist);
      } catch (err) {
        const msg = 'Error occurred in updating xss';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-xss-failed'));
      }

      const reqestXssParams = {
        'markdown:rehypeSanitize:isEnabledPrevention': req.body.isEnabledXss,
        'markdown:rehypeSanitize:option': req.body.xssOption,
        'markdown:rehypeSanitize:tagNames': req.body.tagWhitelist,
        'markdown:rehypeSanitize:attributes': req.body.attrWhitelist,
      };

      try {
        await configManager.updateConfigs(reqestXssParams);
        const xssParams = {
          isEnabledXss: await crowi.configManager.getConfig(
            'markdown:rehypeSanitize:isEnabledPrevention',
          ),
          xssOption: await crowi.configManager.getConfig(
            'markdown:rehypeSanitize:option',
          ),
          tagWhitelist: await crowi.configManager.getConfig(
            'markdown:rehypeSanitize:tagNames',
          ),
          attrWhitelist: await crowi.configManager.getConfig(
            'markdown:rehypeSanitize:attributes',
          ),
        };

        const parameters = {
          action: SupportedAction.ACTION_ADMIN_MARKDOWN_XSS_UPDATE,
        };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ xssParams });
      } catch (err) {
        const msg = 'Error occurred in updating xss';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-xss-failed'));
      }
    },
  );

  return router;
};
