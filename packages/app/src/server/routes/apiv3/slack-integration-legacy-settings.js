import loggerFactory from '~/utils/logger';

// eslint-disable-next-line no-unused-vars
const logger = loggerFactory('growi:routes:apiv3:slack-integration-legacy-setting');

const express = require('express');

const router = express.Router();

const { body } = require('express-validator');

const ErrorV3 = require('../../models/vo/error-apiv3');

const validator = {
  slackConfiguration: [
    body('webhookUrl').if(value => value != null).isString().trim(),
    body('isIncomingWebhookPrioritized').isBoolean(),
    body('slackToken').if(value => value != null).isString().trim(),
  ],
};

/**
 * @swagger
 *  tags:
 *    name: SlackIntegrationLegacySetting
 */

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
module.exports = (crowi) => {
  const loginRequiredStrictly = require('../../middlewares/login-required')(crowi);
  const adminRequired = require('../../middlewares/admin-required')(crowi);
  const csrf = require('../../middlewares/csrf')(crowi);
  const apiV3FormValidator = require('../../middlewares/apiv3-form-validator')(crowi);

  /**
   * @swagger
   *
   *    /slack-integration-legacy-setting/:
   *      get:
   *        tags: [SlackIntegrationLegacySetting]
   *        description: Get slack configuration setting
   *        responses:
   *          200:
   *            description: params of slack configuration setting
   *            content:
   *              application/json:
   *                schema:
   *                  properties:
   *                    notificationParams:
   *                      type: object
   *                      description: slack configuration setting params
   */
  router.get('/', loginRequiredStrictly, adminRequired, async(req, res) => {

    const slackIntegrationParams = {
      isSlackbotConfigured: crowi.slackIntegrationService.isSlackbotConfigured,
      webhookUrl: await crowi.configManager.getConfig('notification', 'slack:incomingWebhookUrl'),
      isIncomingWebhookPrioritized: await crowi.configManager.getConfig('notification', 'slack:isIncomingWebhookPrioritized'),
      slackToken: await crowi.configManager.getConfig('notification', 'slack:token'),
    };
    return res.apiv3({ slackIntegrationParams });
  });

  /**
   * @swagger
   *
   *    /slack-integration-legacy-setting/:
   *      put:
   *        tags: [SlackIntegrationLegacySetting]
   *        description: Update slack configuration setting
   *        requestBody:
   *          required: true
   *          content:
   *            application/json:
   *              schema:
   *                $ref: '#/components/schemas/SlackConfigurationParams'
   *        responses:
   *          200:
   *            description: Succeeded to update slack configuration setting
   *            content:
   *              application/json:
   *                schema:
   *                  $ref: '#/components/schemas/SlackConfigurationParams'
   */
  router.put('/', loginRequiredStrictly, adminRequired, csrf, validator.slackConfiguration, apiV3FormValidator, async(req, res) => {

    const requestParams = {
      'slack:incomingWebhookUrl': req.body.webhookUrl,
      'slack:isIncomingWebhookPrioritized': req.body.isIncomingWebhookPrioritized,
      'slack:token': req.body.slackToken,
    };

    try {
      await crowi.configManager.updateConfigsInTheSameNamespace('notification', requestParams);
      const responseParams = {
        webhookUrl: await crowi.configManager.getConfig('notification', 'slack:incomingWebhookUrl'),
        isIncomingWebhookPrioritized: await crowi.configManager.getConfig('notification', 'slack:isIncomingWebhookPrioritized'),
        slackToken: await crowi.configManager.getConfig('notification', 'slack:token'),
      };
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
