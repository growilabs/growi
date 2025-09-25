// Now Home tab is disabled
// TODO Imple Home tab

import type { ViewsPublishResponse, WebClient } from '@slack/web-api';

export const publishInitialHomeView = (
  client: WebClient,
  userId: string,
): Promise<ViewsPublishResponse> => {
  return client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Welcome GROWI Official Bot Home',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              'Learn how to use GROWI Official bot.' +
              'See <https://docs.growi.org/en/admin-guide/management-cookbook/slack-integration/official-bot-settings.html#official-bot-settings | Docs>.',
          },
        },
      ],
    },
  });
};
