import {
  type GrowiBotEvent,
  type GrowiCommand,
  SlackbotType,
} from '@growi/slack';
import { markdownSectionBlock } from '@growi/slack/dist/utils/block-kit-builder';
import type { InteractionPayloadAccessor } from '@growi/slack/dist/utils/interaction-payload-accessor';
import type { RespondUtil } from '@growi/slack/dist/utils/respond-util-factory';
import { generateWebClient } from '@growi/slack/dist/utils/webclient-factory';
import type { ChatPostMessageArguments, WebClient } from '@slack/web-api';
import type { IncomingWebhookSendArguments } from '@slack/webhook';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import type { EventActionsPermission } from '../interfaces/slack-integration/events';
import S2sMessage from '../models/vo/s2s-message';
import { SlackCommandHandlerError } from '../models/vo/slack-command-handler-error';
import { slackLegacyUtilFactory } from '../util/slack-legacy';
import { configManager } from './config-manager';
import type { S2sMessagingService } from './s2s-messaging/base';
import type { S2sMessageHandlable } from './s2s-messaging/handlable';
import { LinkSharedEventHandler } from './slack-event-handler/link-shared';

const logger = loggerFactory('growi:service:SlackBotService');

const OFFICIAL_SLACKBOT_PROXY_URI = 'https://slackbot-proxy.growi.org';

type S2sMessageForSlackIntegration = S2sMessage & { updatedAt: Date };

export class SlackIntegrationService implements S2sMessageHandlable {
  crowi: Crowi;

  s2sMessagingService!: S2sMessagingService;

  lastLoadedAt?: Date;

  linkSharedHandler!: LinkSharedEventHandler;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.s2sMessagingService = crowi.s2sMessagingService;
    this.linkSharedHandler = new LinkSharedEventHandler(crowi);

    this.initialize();
  }

  initialize() {
    this.lastLoadedAt = new Date();
  }

  /**
   * @inheritdoc
   */
  shouldHandleS2sMessage(s2sMessage: S2sMessageForSlackIntegration): boolean {
    const { eventName, updatedAt } = s2sMessage;
    if (eventName !== 'slackIntegrationServiceUpdated' || updatedAt == null) {
      return false;
    }

    return (
      this.lastLoadedAt == null ||
      this.lastLoadedAt < new Date(s2sMessage.updatedAt)
    );
  }

  /**
   * @inheritdoc
   */
  async handleS2sMessage(): Promise<void> {
    const { configManager } = this.crowi;

    logger.info('Reset slack bot by pubsub notification');
    await configManager.loadConfigs();
    this.initialize();
  }

  async publishUpdatedMessage(): Promise<void> {
    const { s2sMessagingService } = this;

    if (s2sMessagingService != null) {
      const s2sMessage = new S2sMessage('slackIntegrationServiceUpdated', {
        updatedAt: new Date(),
      });

      try {
        await s2sMessagingService.publish(s2sMessage);
      } catch (e) {
        logger.error(
          'Failed to publish update message with S2sMessagingService: ',
          e.message,
        );
      }
    }
  }

  get isSlackConfigured(): boolean {
    return this.isSlackbotConfigured || this.isSlackLegacyConfigured;
  }

  get isSlackbotConfigured(): boolean {
    const hasSlackbotType = !!configManager.getConfig(
      'slackbot:currentBotType',
    );
    return hasSlackbotType;
  }

  get isSlackLegacyConfigured(): boolean {
    // for legacy util
    const hasSlackToken = !!configManager.getConfig('slack:token');
    const hasSlackIwhUrl = !!configManager.getConfig(
      'slack:incomingWebhookUrl',
    );

    return hasSlackToken || hasSlackIwhUrl;
  }

  private isCheckTypeValid(): boolean {
    const currentBotType = configManager.getConfig('slackbot:currentBotType');
    if (currentBotType == null) {
      throw new Error(
        "The config 'SLACKBOT_TYPE'(ns: 'crowi', key: 'slackbot:currentBotType') must be set.",
      );
    }

    return true;
  }

  get proxyUriForCurrentType(): string | undefined {
    const currentBotType = configManager.getConfig('slackbot:currentBotType');

    // TODO assert currentBotType is not null and CUSTOM_WITHOUT_PROXY

    let proxyUri: string | undefined;

    switch (currentBotType) {
      case SlackbotType.OFFICIAL:
        proxyUri = OFFICIAL_SLACKBOT_PROXY_URI;
        break;
      default:
        proxyUri = configManager.getConfig('slackbot:proxyUri');
        break;
    }

    return proxyUri;
  }

  /**
   * generate WebClient instance for CUSTOM_WITHOUT_PROXY type
   */
  async generateClientForCustomBotWithoutProxy(): Promise<WebClient> {
    this.isCheckTypeValid();

    const token = configManager.getConfig('slackbot:withoutProxy:botToken');

    if (token == null) {
      throw new Error(
        "The config 'SLACK_BOT_TOKEN'(ns: 'crowi', key: 'slackbot:withoutProxy:botToken') must be set.",
      );
    }

    return generateWebClient(token);
  }

  /**
   * generate WebClient instance by tokenPtoG
   * @param tokenPtoG
   */
  async generateClientByTokenPtoG(tokenPtoG: string): Promise<WebClient> {
    this.isCheckTypeValid();

    const SlackAppIntegration = mongoose.model('SlackAppIntegration');

    const slackAppIntegration = await SlackAppIntegration.findOne({
      tokenPtoG,
    });

    if (slackAppIntegration == null) {
      throw new Error(
        'No SlackAppIntegration exists that corresponds to the tokenPtoG specified.',
      );
    }

    return this.generateClientBySlackAppIntegration(
      slackAppIntegration as unknown as { tokenGtoP: string },
    );
  }

  /**
   * generate WebClient instance by tokenPtoG
   * @param tokenPtoG
   */
  async generateClientForPrimaryWorkspace(): Promise<WebClient> {
    this.isCheckTypeValid();

    const currentBotType = configManager.getConfig('slackbot:currentBotType');

    if (currentBotType === SlackbotType.CUSTOM_WITHOUT_PROXY) {
      return this.generateClientForCustomBotWithoutProxy();
    }

    // retrieve primary SlackAppIntegration
    const SlackAppIntegration = mongoose.model('SlackAppIntegration');
    const slackAppIntegration = await SlackAppIntegration.findOne({
      isPrimary: true,
    });

    if (slackAppIntegration == null) {
      throw new Error('None of the primary SlackAppIntegration exists.');
    }

    return this.generateClientBySlackAppIntegration(
      slackAppIntegration as unknown as { tokenGtoP: string },
    );
  }

  /**
   * generate WebClient instance by SlackAppIntegration
   * @param slackAppIntegration
   */
  async generateClientBySlackAppIntegration(slackAppIntegration: {
    tokenGtoP: string;
  }): Promise<WebClient> {
    this.isCheckTypeValid();

    // connect to proxy
    const serverUri = new URL('/g2s', this.proxyUriForCurrentType);
    const headers = {
      'x-growi-gtop-tokens': slackAppIntegration.tokenGtoP,
    };

    return generateWebClient(undefined, serverUri.toString(), headers);
  }

  async postMessage(
    messageArgs: ChatPostMessageArguments,
    slackAppIntegration?: { tokenGtoP: string },
  ): Promise<void> {
    // use legacy slack configuration
    if (this.isSlackLegacyConfigured && !this.isSlackbotConfigured) {
      return this.postMessageWithLegacyUtil(messageArgs);
    }

    const client =
      slackAppIntegration == null
        ? await this.generateClientForPrimaryWorkspace()
        : await this.generateClientBySlackAppIntegration(slackAppIntegration);

    try {
      await client.chat.postMessage(messageArgs);
    } catch (error) {
      logger.debug('Post error', error);
      logger.debug('Sent data to slack is:', messageArgs);
      throw error;
    }
  }

  private async postMessageWithLegacyUtil(
    messageArgs: ChatPostMessageArguments | IncomingWebhookSendArguments,
  ): Promise<void> {
    const slackLegacyUtil = slackLegacyUtilFactory(configManager);

    try {
      await slackLegacyUtil.postMessage(messageArgs);
    } catch (error) {
      logger.debug('Post error', error);
      logger.debug('Sent data to slack is:', messageArgs);
      throw error;
    }
  }

  /**
   * Handle /commands endpoint
   */
  async handleCommandRequest(
    growiCommand: GrowiCommand,
    client,
    body,
    respondUtil: RespondUtil,
  ): Promise<void> {
    const { growiCommandType } = growiCommand;
    const modulePath = `./slack-command-handler/${growiCommandType}`;

    let handler;
    try {
      handler = require(modulePath)(this.crowi);
    } catch (err) {
      const text = `*No command.*\n \`command: ${growiCommand.text}\``;
      logger.error(err);
      throw new SlackCommandHandlerError(text, {
        respondBody: {
          text,
          blocks: [
            markdownSectionBlock(
              '*No command.*\n Hint\n `/growi [command] [keyword]`',
            ),
          ],
        },
      });
    }

    // Do not wrap with try-catch. Errors thrown by slack-command-handler modules will be handled in router.
    return handler.handleCommand(growiCommand, client, body, respondUtil);
  }

  async handleBlockActionsRequest(
    client,
    interactionPayload: any,
    interactionPayloadAccessor: InteractionPayloadAccessor,
    respondUtil: RespondUtil,
  ): Promise<void> {
    const { actionId } =
      interactionPayloadAccessor.getActionIdAndCallbackIdFromPayLoad();
    const commandName = actionId.split(':')[0];
    const handlerMethodName = actionId.split(':')[1];

    const modulePath = `./slack-command-handler/${commandName}`;

    let handler;
    try {
      handler = require(modulePath)(this.crowi);
    } catch (err) {
      throw new SlackCommandHandlerError(
        `No interaction.\n \`actionId: ${actionId}\``,
      );
    }

    // Do not wrap with try-catch. Errors thrown by slack-command-handler modules will be handled in router.
    return handler.handleInteractions(
      client,
      interactionPayload,
      interactionPayloadAccessor,
      handlerMethodName,
      respondUtil,
    );
  }

  async handleViewSubmissionRequest(
    client,
    interactionPayload: any,
    interactionPayloadAccessor: InteractionPayloadAccessor,
    respondUtil: RespondUtil,
  ): Promise<void> {
    const { callbackId } =
      interactionPayloadAccessor.getActionIdAndCallbackIdFromPayLoad();
    const commandName = callbackId.split(':')[0];
    const handlerMethodName = callbackId.split(':')[1];

    const modulePath = `./slack-command-handler/${commandName}`;

    let handler;
    try {
      handler = require(modulePath)(this.crowi);
    } catch (err) {
      throw new SlackCommandHandlerError(
        `No interaction.\n \`callbackId: ${callbackId}\``,
      );
    }

    // Do not wrap with try-catch. Errors thrown by slack-command-handler modules will be handled in router.
    return handler.handleInteractions(
      client,
      interactionPayload,
      interactionPayloadAccessor,
      handlerMethodName,
      respondUtil,
    );
  }

  async handleEventsRequest(
    client: WebClient,
    growiBotEvent: GrowiBotEvent<any>,
    permission: EventActionsPermission,
    data?: any,
  ): Promise<void> {
    const { eventType } = growiBotEvent;
    const { channel = '' } = growiBotEvent.event; // only channelId

    if (this.linkSharedHandler.shouldHandle(eventType, permission, channel)) {
      return this.linkSharedHandler.handleEvent(client, growiBotEvent, data);
    }

    logger.error(
      `Any event actions are not permitted, or, a handler for '${eventType}' event is not implemented`,
    );
  }
}
