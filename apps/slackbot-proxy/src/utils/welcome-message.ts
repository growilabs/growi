import { markdownSectionBlock } from '@growi/slack/dist/utils/block-kit-builder';
import { ChatPostMessageResponse, WebClient } from '@slack/web-api';

export const postWelcomeMessageOnce = async (
  client: WebClient,
  channel: string,
): Promise<undefined | ChatPostMessageResponse> => {
  const history = await client.conversations.history({
    channel,
    limit: 1,
  });

  // skip posting on the second time or later
  if (history.messages != null && history.messages.length > 0) {
    return;
  }

  return client.chat.postMessage({
    channel,
    blocks: [
      markdownSectionBlock(
        'Hi! This is GROWI bot.\n' +
          'You can invoke any feature with `/growi [command]` in any channel. Type `/growi help` to check the available features.',
      ),
      markdownSectionBlock(
        'Looking for additional help? ' +
          // eslint-disable-next-line max-len
          'See <https://docs.growi.org/en/admin-guide/management-cookbook/slack-integration/official-bot-settings.html#official-bot-settings | Docs>.',
      ),
    ],
  });
};

export const postInstallSuccessMessage = async (
  client: WebClient,
  userId: string,
): Promise<ChatPostMessageResponse> => {
  return client.chat.postMessage({
    channel: userId,
    blocks: [
      markdownSectionBlock(
        ':tada: You have successfully installed GROWI bot on this Slack workspace.\n' +
          'At first you do `/growi register` in the channel that you want to use.',
      ),
      markdownSectionBlock(
        'Looking for additional help? ' +
          // eslint-disable-next-line max-len
          'See <https://docs.growi.org/en/admin-guide/management-cookbook/slack-integration/official-bot-settings.html#official-bot-settings | Docs>.',
      ),
    ],
  });
};
