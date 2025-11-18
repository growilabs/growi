import { generateWebClient } from '@growi/slack/dist/utils/webclient-factory';
import { IMiddleware, Middleware, Req } from '@tsed/common';
import Logger from 'bunyan';

import { SlackOauthReq } from '~/interfaces/slack-to-growi/slack-oauth-req';
import loggerFactory from '~/utils/logger';

const logger: Logger = loggerFactory(
  'slackbot-proxy:middlewares:JoinToConversationsMiddleware',
);

/**
 * This middleware should be processed after AuthorizeCommandMiddleware or AuthorizeInteractionMiddleware
 */
@Middleware()
export class JoinToConversationMiddleware implements IMiddleware {
  async use(@Req() req: SlackOauthReq): Promise<void> {
    const { body, authorizeResult } = req;

    // biome-ignore lint/style/noNonNullAssertion: ignore
    const client = generateWebClient(authorizeResult.botToken!);

    try {
      await client.conversations.join({ channel: body.channel_id });
    } catch (err) {
      logger.error(err);
    }
  }
}
