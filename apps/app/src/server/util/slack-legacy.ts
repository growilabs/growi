import type { ChatPostMessageArguments } from '@slack/web-api';
import { WebClient } from '@slack/web-api';
import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from '@slack/webhook';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:util:slack-legacy');

interface SlackLegacyUtil {
  postMessage(
    messageObj: IncomingWebhookSendArguments | ChatPostMessageArguments,
  ): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const slackLegacyUtilFactory = (configManager: any): SlackLegacyUtil => {
  const postWithIwh = async (messageObj: IncomingWebhookSendArguments) => {
    const webhook = new IncomingWebhook(
      configManager.getConfig('slack:incomingWebhookUrl'),
    );
    try {
      await webhook.send(messageObj);
    } catch (error) {
      logger.debug('Post error', error);
      logger.debug('Sent data to slack is:', messageObj);
      throw error;
    }
  };

  const postWithWebApi = async (messageObj?: ChatPostMessageArguments) => {
    const client = new WebClient(configManager.getConfig('slack:token'));
    try {
      await client.chat.postMessage(messageObj);
    } catch (error) {
      logger.debug('Post error', error);
      logger.debug('Sent data to slack is:', messageObj);
      throw error;
    }
  };

  return {
    postMessage: async (messageObj) => {
      // when incoming Webhooks is prioritized
      if (configManager.getConfig('slack:isIncomingWebhookPrioritized')) {
        if (configManager.getConfig('slack:incomingWebhookUrl')) {
          logger.debug('posting message with IncomingWebhook');
          return postWithIwh(messageObj as IncomingWebhookSendArguments);
        }
        if (configManager.getConfig('slack:token')) {
          logger.debug('posting message with Web API');
          return postWithWebApi(messageObj as ChatPostMessageArguments);
        }
      }
      // else
      else {
        if (configManager.getConfig('slack:token')) {
          logger.debug('posting message with Web API');
          return postWithWebApi(messageObj as ChatPostMessageArguments);
        }
        if (configManager.getConfig('slack:incomingWebhookUrl')) {
          logger.debug('posting message with IncomingWebhook');
          return postWithIwh(messageObj as IncomingWebhookSendArguments);
        }
      }
    },
  };
};
