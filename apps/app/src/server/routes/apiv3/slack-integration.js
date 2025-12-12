import { ErrorV3 } from '@growi/core/dist/models';
import { supportedGrowiCommands } from '@growi/slack';
import { verifySlackRequest } from '@growi/slack/dist/middlewares';
import { InvalidGrowiCommandError } from '@growi/slack/dist/models';
import { markdownSectionBlock } from '@growi/slack/dist/utils/block-kit-builder';
import { InteractionPayloadAccessor } from '@growi/slack/dist/utils/interaction-payload-accessor';
import { generateRespondUtil } from '@growi/slack/dist/utils/respond-util-factory';
import { isValidResponseUrl } from '@growi/slack/dist/utils/response-url-validator';
import { parseSlashCommand } from '@growi/slack/dist/utils/slash-command-parser';
import express from 'express';
import { body } from 'express-validator';
import createError from 'http-errors';
import mongoose from 'mongoose';

import { SlackCommandHandlerError } from '~/server/models/vo/slack-command-handler-error';
import { configManager } from '~/server/service/config-manager';
import { growiInfoService } from '~/server/service/growi-info';
import loggerFactory from '~/utils/logger';

import { handleError } from '../../service/slack-command-handler/error-handler';
import { checkPermission } from '../../util/slack-integration';

const logger = loggerFactory('growi:routes:apiv3:slack-integration');
const router = express.Router();
const SlackAppIntegration = mongoose.model('SlackAppIntegration');

/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const { slackIntegrationService } = crowi;

  // Check if the access token is correct
  async function verifyAccessTokenFromProxy(req, res, next) {
    const tokenPtoG = req.headers['x-growi-ptog-tokens'];

    if (tokenPtoG == null) {
      const message =
        "The value of header 'x-growi-ptog-tokens' must not be empty.";
      logger.warn(message, { body: req.body });
      return next(createError(400, message));
    }

    const SlackAppIntegrationCount = await SlackAppIntegration.countDocuments({
      tokenPtoG,
    });

    logger.debug('verifyAccessTokenFromProxy', {
      tokenPtoG,
      SlackAppIntegrationCount,
    });

    if (SlackAppIntegrationCount === 0) {
      return res.status(403).send({
        message:
          'The access token that identifies the request source is slackbot-proxy is invalid. Did you setup with `/growi register`.\n' +
          'Or did you delete registration for GROWI ? if so, the link with GROWI has been disconnected. ' +
          'Please unregister the information registered in the proxy and setup `/growi register` again.',
      });
    }

    next();
  }

  async function extractPermissionsCommands(tokenPtoG) {
    const slackAppIntegration = await SlackAppIntegration.findOne({
      tokenPtoG,
    });
    if (slackAppIntegration == null) return null;
    const permissionsForBroadcastUseCommands =
      slackAppIntegration.permissionsForBroadcastUseCommands;
    const permissionsForSingleUseCommands =
      slackAppIntegration.permissionsForSingleUseCommands;

    return {
      permissionsForBroadcastUseCommands,
      permissionsForSingleUseCommands,
    };
  }

  // TODO: move this middleware to each controller
  // no res.send() is allowed after this middleware
  async function checkCommandsPermission(req, res, next) {
    // Send response immediately to avoid opelation_timeout error
    // See https://api.slack.com/apis/connections/events-api#the-events-api__responding-to-events
    // for without proxy
    res.send();

    let growiCommand;
    try {
      growiCommand = getGrowiCommand(req.body);
    } catch (err) {
      logger.error(err.message);
      return next(err);
    }

    // not supported commands
    if (!supportedGrowiCommands.includes(growiCommand.growiCommandType)) {
      const options = {
        respondBody: {
          text: 'Command is not supported',
          blocks: [
            markdownSectionBlock('*Command is not supported*'),
            // eslint-disable-next-line max-len
            markdownSectionBlock(
              `\`/growi ${growiCommand.growiCommandType}\` command is not supported in this version of GROWI bot. Run \`/growi help\` to see all supported commands.`,
            ),
          ],
        },
      };
      return next(
        new SlackCommandHandlerError('Command type is not specified', options),
      );
    }

    const tokenPtoG = req.headers['x-growi-ptog-tokens'];
    const extractPermissions = await extractPermissionsCommands(tokenPtoG);
    const fromChannel = {
      id: req.body.channel_id,
      name: req.body.channel_name,
    };
    const siteUrl = growiInfoService.getSiteUrl();

    let commandPermission;
    if (extractPermissions != null) {
      // with proxy
      const {
        permissionsForBroadcastUseCommands,
        permissionsForSingleUseCommands,
      } = extractPermissions;
      commandPermission = Object.fromEntries([
        ...permissionsForBroadcastUseCommands,
        ...permissionsForSingleUseCommands,
      ]);
      const isPermitted = checkPermission(
        commandPermission,
        growiCommand.growiCommandType,
        fromChannel,
      );
      if (isPermitted) return next();

      return next(
        createError(
          403,
          `It is not allowed to send \`/growi ${growiCommand.growiCommandType}\` command to this GROWI: ${siteUrl}`,
        ),
      );
    }

    // without proxy
    commandPermission = configManager.getConfig(
      'slackbot:withoutProxy:commandPermission',
    );

    const isPermitted = checkPermission(
      commandPermission,
      growiCommand.growiCommandType,
      fromChannel,
    );
    if (isPermitted) {
      return next();
    }
    // show ephemeral error message if not permitted
    const options = {
      respondBody: {
        text: 'Command forbidden',
        blocks: [
          markdownSectionBlock('*Command is not supported*'),
          markdownSectionBlock(
            `It is not allowed to send \`/growi ${growiCommand.growiCommandType}\` command to this GROWI: ${siteUrl}`,
          ),
        ],
      },
    };
    return next(
      new SlackCommandHandlerError('Command type is not specified', options),
    );
  }

  // TODO: move this middleware to each controller
  // no res.send() is allowed after this middleware
  async function checkInteractionsPermission(req, res, next) {
    // Send response immediately to avoid opelation_timeout error
    // See https://api.slack.com/apis/connections/events-api#the-events-api__responding-to-events
    // for without proxy
    res.send();

    const { interactionPayloadAccessor } = req;
    const siteUrl = growiInfoService.getSiteUrl();

    const { actionId, callbackId } =
      interactionPayloadAccessor.getActionIdAndCallbackIdFromPayLoad();
    const callbacIdkOrActionId = callbackId || actionId;
    const fromChannel = interactionPayloadAccessor.getChannel();

    const tokenPtoG = req.headers['x-growi-ptog-tokens'];
    const extractPermissions = await extractPermissionsCommands(tokenPtoG);
    let commandPermission;
    if (extractPermissions != null) {
      // with proxy
      const {
        permissionsForBroadcastUseCommands,
        permissionsForSingleUseCommands,
      } = extractPermissions;
      commandPermission = Object.fromEntries([
        ...permissionsForBroadcastUseCommands,
        ...permissionsForSingleUseCommands,
      ]);
      const isPermitted = checkPermission(
        commandPermission,
        callbacIdkOrActionId,
        fromChannel,
      );
      if (isPermitted) return next();

      return next(
        createError(
          403,
          `This interaction is forbidden on this GROWI: ${siteUrl}`,
        ),
      );
    }

    // without proxy
    commandPermission = configManager.getConfig(
      'slackbot:withoutProxy:commandPermission',
    );

    const isPermitted = checkPermission(
      commandPermission,
      callbacIdkOrActionId,
      fromChannel,
    );
    if (isPermitted) {
      return next();
    }
    // show ephemeral error message if not permitted
    const options = {
      respondBody: {
        text: 'Interaction forbidden',
        blocks: [
          markdownSectionBlock('*Interaction forbidden*'),
          markdownSectionBlock(
            `This interaction is forbidden on this GROWI: ${siteUrl}`,
          ),
        ],
      },
    };
    return next(new SlackCommandHandlerError('Interaction forbidden', options));
  }

  const addSigningSecretToReq = (req, res, next) => {
    req.slackSigningSecret = configManager.getConfig(
      'slackbot:withoutProxy:signingSecret',
    );
    return next();
  };

  const verifyUrlMiddleware = (req, res, next) => {
    const { body } = req;

    // eslint-disable-next-line max-len
    // see: https://api.slack.com/apis/connections/events-api#the-events-api__subscribing-to-event-types__events-api-request-urls__request-url-configuration--verification
    if (body.type === 'url_verification') {
      return res.send({ challenge: body.challenge });
    }

    next();
  };

  const parseSlackInteractionRequest = (req, res, next) => {
    if (req.body.payload == null) {
      return next(
        new Error('The payload is not in the request from slack or proxy.'),
      );
    }

    req.interactionPayload = JSON.parse(req.body.payload);
    req.interactionPayloadAccessor = new InteractionPayloadAccessor(
      req.interactionPayload,
    );

    return next();
  };

  function getRespondUtil(responseUrl) {
    const proxyUri = slackIntegrationService.proxyUriForCurrentType ?? null; // can be null

    const appSiteUrl = growiInfoService.getSiteUrl();
    if (appSiteUrl == null || appSiteUrl === '') {
      logger.error('App site url must exist.');
      throw SlackCommandHandlerError('App site url must exist.');
    }

    return generateRespondUtil({ responseUrl, proxyUri, appSiteUrl });
  }

  function getGrowiCommand(body) {
    let { growiCommand } = body;
    if (growiCommand == null) {
      try {
        growiCommand = parseSlashCommand(body);
      } catch (err) {
        if (err instanceof InvalidGrowiCommandError) {
          const options = {
            respondBody: {
              text: 'Command type is not specified',
              blocks: [
                markdownSectionBlock('*Command type is not specified.*'),
                markdownSectionBlock(
                  'Run `/growi help` to check the commands you can use.',
                ),
              ],
            },
          };
          throw new SlackCommandHandlerError(
            'Command type is not specified',
            options,
          );
        }
        throw err;
      }
    }
    return growiCommand;
  }

  async function handleCommands(body, res, client, responseUrl) {
    let growiCommand;
    let respondUtil;
    try {
      growiCommand = getGrowiCommand(body);
      respondUtil = getRespondUtil(responseUrl);
    } catch (err) {
      logger.error(err.message);
      return handleError(err, responseUrl);
    }

    const { text } = growiCommand;

    if (text == null) {
      return 'No text.';
    }

    // Send response immediately to avoid opelation_timeout error
    // See https://api.slack.com/apis/connections/events-api#the-events-api__responding-to-events
    const appSiteUrl = growiInfoService.getSiteUrl();
    try {
      await respondUtil.respond({
        text: 'Processing your request ...',
        blocks: [
          markdownSectionBlock(
            `Processing your request *"/growi ${growiCommand.growiCommandType}"* on GROWI at ${appSiteUrl} ...`,
          ),
        ],
      });
    } catch (err) {
      logger.error('Error occurred while request via axios:', err);
    }

    try {
      await slackIntegrationService.handleCommandRequest(
        growiCommand,
        client,
        body,
        respondUtil,
      );
    } catch (err) {
      logger.error(err.message);
      return handleError(err, responseUrl);
    }
  }

  // TODO: this method will be a middleware when typescriptize in the future
  function getResponseUrl(req) {
    const { body } = req;
    const responseUrl = body?.growiCommand?.responseUrl ?? body.response_url;

    if (responseUrl == null) {
      return null;
    }

    const proxyUri = slackIntegrationService.proxyUriForCurrentType;

    if (!isValidResponseUrl(responseUrl, proxyUri)) {
      throw createError(400, 'Invalid response_url');
    }

    return responseUrl;
  }

  /**
   * @swagger
   *
   * /slack-integration/commands:
   *   post:
   *     tags: [SlackIntegration]
   *     security:
   *       - cookieAuth: []
   *     summary: /slack-integration/commands
   *     description: Handle Slack commands
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: string
   *               example: "No text."
   */
  router.post(
    '/commands',
    addSigningSecretToReq,
    verifySlackRequest,
    checkCommandsPermission,
    async (req, res) => {
      const { body } = req;
      const responseUrl = getResponseUrl(req);

      let client;
      try {
        client =
          await slackIntegrationService.generateClientForCustomBotWithoutProxy();
      } catch (err) {
        logger.error(err.message);
        return handleError(err, responseUrl);
      }

      return handleCommands(body, res, client, responseUrl);
    },
  );

  // when relation test
  /**
   * @swagger
   *
   * /slack-integration/proxied/verify:
   *   post:
   *     tags: [SlackIntegration]
   *     security:
   *       - cookieAuth: []
   *     summary: /slack-integration/proxied/verify
   *     description: Verify the access token
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               type:
   *                 type: string
   *               challenge:
   *                 type: string
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 challenge:
   *                   type: string
   */
  router.post(
    '/proxied/verify',
    verifyAccessTokenFromProxy,
    async (req, res) => {
      const { body } = req;

      // eslint-disable-next-line max-len
      // see: https://api.slack.com/apis/connections/events-api#the-events-api__subscribing-to-event-types__events-api-request-urls__request-url-configuration--verification
      if (body.type === 'url_verification') {
        return res.send({ challenge: body.challenge });
      }
    },
  );

  /**
   * @swagger
   *
   * /slack-integration/proxied/commands:
   *   post:
   *     tags: [SlackIntegration]
   *     security:
   *       - cookieAuth: []
   *     summary: /slack-integration/proxied/commands
   *     description: Handle Slack commands
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: string
   *               example: "No text."
   */
  router.post(
    '/proxied/commands',
    verifyAccessTokenFromProxy,
    checkCommandsPermission,
    async (req, res) => {
      const { body } = req;
      const responseUrl = getResponseUrl(req);

      const tokenPtoG = req.headers['x-growi-ptog-tokens'];

      let client;
      try {
        client =
          await slackIntegrationService.generateClientByTokenPtoG(tokenPtoG);
      } catch (err) {
        logger.error(err.message);
        return handleError(err, responseUrl);
      }

      return handleCommands(body, res, client, responseUrl);
    },
  );

  async function handleInteractionsRequest(req, res, client) {
    const { interactionPayload, interactionPayloadAccessor } = req;
    const { type } = interactionPayload;
    const responseUrl = interactionPayloadAccessor.getResponseUrl();

    try {
      const respondUtil = getRespondUtil(responseUrl);
      switch (type) {
        case 'block_actions':
          await slackIntegrationService.handleBlockActionsRequest(
            client,
            interactionPayload,
            interactionPayloadAccessor,
            respondUtil,
          );
          break;
        case 'view_submission':
          await slackIntegrationService.handleViewSubmissionRequest(
            client,
            interactionPayload,
            interactionPayloadAccessor,
            respondUtil,
          );
          break;
        default:
          break;
      }
    } catch (err) {
      logger.error(err);
      return handleError(err, responseUrl);
    }
  }

  /**
   * @swagger
   *
   * /slack-integration/interactions:
   *   post:
   *     tags: [SlackIntegration]
   *     security:
   *       - cookieAuth: []
   *     summary: /slack-integration/interactions
   *     description: Handle Slack interactions
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: OK
   */
  router.post(
    '/interactions',
    addSigningSecretToReq,
    verifySlackRequest,
    parseSlackInteractionRequest,
    checkInteractionsPermission,
    async (req, res) => {
      const client =
        await slackIntegrationService.generateClientForCustomBotWithoutProxy();
      return handleInteractionsRequest(req, res, client);
    },
  );

  /**
   * @swagger
   *
   * /slack-integration/proxied/interactions:
   *   post:
   *     tags: [SlackIntegration]
   *     security:
   *       - cookieAuth: []
   *     summary: /slack-integration/proxied/interactions
   *     description: Handle Slack interactions
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: OK
   */
  router.post(
    '/proxied/interactions',
    verifyAccessTokenFromProxy,
    parseSlackInteractionRequest,
    checkInteractionsPermission,
    async (req, res) => {
      const tokenPtoG = req.headers['x-growi-ptog-tokens'];
      const client =
        await slackIntegrationService.generateClientByTokenPtoG(tokenPtoG);
      return handleInteractionsRequest(req, res, client);
    },
  );

  /**
   * @swagger
   *
   * /slack-integration/supported-commands:
   *   get:
   *     tags: [SlackIntegration]
   *     security:
   *       - cookieAuth: []
   *     summary: /slack-integration/supported-commands
   *     description: Get supported commands
   *     responses:
   *       200:
   *         description: Supported commands
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 permissionsForBroadcastUseCommands:
   *                   type: array
   *                   items:
   *                     type: object
   *                 permissionsForSingleUseCommands:
   *                   type: array
   *                   items:
   *                     type: object
   */
  router.get(
    '/supported-commands',
    verifyAccessTokenFromProxy,
    async (req, res) => {
      const tokenPtoG = req.headers['x-growi-ptog-tokens'];
      const slackAppIntegration = await SlackAppIntegration.findOne({
        tokenPtoG,
      });
      const {
        permissionsForBroadcastUseCommands,
        permissionsForSingleUseCommands,
      } = slackAppIntegration;

      return res.apiv3({
        permissionsForBroadcastUseCommands,
        permissionsForSingleUseCommands,
      });
    },
  );

  /**
   * @swagger
   *
   * /slack-integration/events:
   *   post:
   *     tags: [SlackIntegration]
   *     security:
   *       - cookieAuth: []
   *     summary: /slack-integration/events
   *     description: Handle Slack events
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               event:
   *                 type: object
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   */
  router.post(
    '/events',
    verifyUrlMiddleware,
    addSigningSecretToReq,
    verifySlackRequest,
    async (req, res) => {
      const { event } = req.body;

      const growiBotEvent = {
        eventType: event.type,
        event,
      };

      try {
        const client =
          await slackIntegrationService.generateClientForCustomBotWithoutProxy();
        // convert permission object to map
        const permission = new Map(
          Object.entries(
            crowi.configManager.getConfig(
              'slackbot:withoutProxy:eventActionsPermission',
            ),
          ),
        );

        await crowi.slackIntegrationService.handleEventsRequest(
          client,
          growiBotEvent,
          permission,
        );

        return res.apiv3({});
      } catch (err) {
        logger.error('Error occurred while handling event request.', err);
        return res.apiv3Err(
          new ErrorV3('Error occurred while handling event request.'),
        );
      }
    },
  );

  const validator = {
    validateEventRequest: [
      body('growiBotEvent').exists(),
      body('data').exists(),
    ],
  };

  /**
   * @swagger
   *
   * /slack-integration/proxied/events:
   *   post:
   *     tags: [SlackIntegration]
   *     security:
   *       - cookieAuth: []
   *     summary: /slack-integration/proxied/events
   *     description: Handle Slack events
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               growiBotEvent:
   *                 type: object
   *               data:
   *                 type: object
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   */
  router.post(
    '/proxied/events',
    verifyAccessTokenFromProxy,
    validator.validateEventRequest,
    async (req, res) => {
      const { growiBotEvent, data } = req.body;

      try {
        const tokenPtoG = req.headers['x-growi-ptog-tokens'];
        const SlackAppIntegration = mongoose.model('SlackAppIntegration');
        const slackAppIntegration = await SlackAppIntegration.findOne({
          tokenPtoG,
        });

        if (slackAppIntegration == null) {
          throw new Error(
            'No SlackAppIntegration exists that corresponds to the tokenPtoG specified.',
          );
        }

        const client =
          await slackIntegrationService.generateClientBySlackAppIntegration(
            slackAppIntegration,
          );
        const { permissionsForSlackEventActions } = slackAppIntegration;

        await slackIntegrationService.handleEventsRequest(
          client,
          growiBotEvent,
          permissionsForSlackEventActions,
          data,
        );

        return res.apiv3({});
      } catch (err) {
        logger.error('Error occurred while handling event request.', err);
        return res.apiv3Err(
          new ErrorV3('Error occurred while handling event request.'),
        );
      }
    },
  );

  // error handler
  router.use(async (err, req, res, next) => {
    const responseUrl = getResponseUrl(req);
    if (responseUrl == null) {
      // pass err to global error handler
      return next(err);
    }

    await handleError(err, responseUrl);
    return;
  });

  return router;
};
