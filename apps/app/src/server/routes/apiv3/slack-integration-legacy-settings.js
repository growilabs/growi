import { ErrorV3 } from '@growi/core/dist/models';
import express from 'express';
import { body } from 'express-validator';

import { SupportedAction } from '~/interfaces/activity';
import { SCOPE } from '@growi/core/dist/interfaces';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { generateAddActivityMiddleware } from '../../middlewares/add-activity';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';


// eslint-disable-next-line no-unused-vars
const logger = loggerFactory('growi:routes:apiv3:slack-integration-legacy-setting');

const router = express.Router();

const validator = {
  slackConfiguration: [
    body('webhookUrl').if(value => value != null).isString().trim(),
    body('isIncomingWebhookPrioritized').isBoolean(),
    body('slackToken').if(value => value != null).isString().trim(),
  ],
};

/**
 * @swagger
 *
 *  components:
 *    schemas:
 *      SlackConfigurationParams:
 *        type: object
 *        properties:
 *          webhookUrl:
 *            type: string
 *            description: incoming webhooks url
 *          isIncomingWebhookPrioritized:
 *            type: boolean
 *            description: use incoming webhooks even if Slack App settings are enabled
 *          slackToken:
 *            type: string
 *            description: OAuth access token
 */
/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../middlewares/login-required')(crowi);
  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const addActivity = generateAddActivityMiddleware(crowi);

  const activityEvent = crowi.event('activity');

  /**
   * @swagger
   *
   *    /slack-integration-legacy-setting/:
   *      get:
   *        tags: [SlackIntegrationLegacySetting]
   *        security:
   *          - cookieAuth: []
   *        description: Get slack configuration setting
   *        responses:
   *          200:
   *            description: params of slack configuration setting
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    slackIntegrationParams:
   *                      type: object
   *                      allOf:
   *                        - $ref: '#/components/schemas/SlackConfigurationParams'
   *                        - type: object
   *                          properties:
   *                            isSlackbotConfigured:
   *                              type: boolean
   *                              description: whether slackbot is configured
   */
  router.get('/', accessTokenParser([SCOPE.READ.ADMIN.LEGACY_SLACK_INTEGRATION]), loginRequiredStrictly, adminRequired, async(req, res) => {

    const slackIntegrationParams = {
      isSlackbotConfigured: crowi.slackIntegrationService.isSlackbotConfigured,
      webhookUrl: await crowi.configManager.getConfig('slack:incomingWebhookUrl'),
      isIncomingWebhookPrioritized: await crowi.configManager.getConfig('slack:isIncomingWebhookPrioritized'),
      slackToken: await crowi.configManager.getConfig('slack:token'),
    };
    return res.apiv3({ slackIntegrationParams });
  });

  /**
   * @swagger
   *
   *    /slack-integration-legacy-setting/:
   *      put:
   *        tags: [SlackIntegrationLegacySetting]
   *        security:
   *          - cookieAuth: []
   *        description: Update slack configuration setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                properties:
   *                  webhookUrl:
   *                    type: string
   *                    description: incoming webhooks url
   *                  isIncomingWebhookPrioritized:
   *                    type: boolean
   *                    description: use incoming webhooks even if Slack App settings are enabled
   *                  slackToken:
   *                    type: string
   *                    description: OAuth access token
   *        responses:
   *          200:
   *            description: Succeeded to update slack configuration setting
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    responseParams:
   *                      type: object
   *                      $ref: '#/components/schemas/SlackConfigurationParams'
   */
  router.put('/', accessTokenParser([SCOPE.WRITE.ADMIN.LEGACY_SLACK_INTEGRATION]), loginRequiredStrictly, adminRequired, addActivity,
    validator.slackConfiguration, apiV3FormValidator, async(req, res) => {

      const requestParams = {
        'slack:incomingWebhookUrl': req.body.webhookUrl,
        'slack:isIncomingWebhookPrioritized': req.body.isIncomingWebhookPrioritized,
        'slack:token': req.body.slackToken,
      };

      try {
        await configManager.updateConfigs(requestParams);
        const responseParams = {
          webhookUrl: await crowi.configManager.getConfig('slack:incomingWebhookUrl'),
          isIncomingWebhookPrioritized: await crowi.configManager.getConfig('slack:isIncomingWebhookPrioritized'),
          slackToken: await crowi.configManager.getConfig('slack:token'),
        };

        const parameters = { action: SupportedAction.ACTION_ADMIN_SLACK_CONFIGURATION_SETTING_UPDATE };
        activityEvent.emit('update', res.locals.activity._id, parameters);

        return res.apiv3({ responseParams });
      }
      catch (err) {
        const msg = 'Error occurred in updating slack configuration';
        logger.error('Error', err);
        return res.apiv3Err(new ErrorV3(msg, 'update-slackConfiguration-failed'));
      }

    });

  return router;
};
