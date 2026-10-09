import urljoin from 'url-join';

import { buildNotificationContent } from '~/features/chat-integration/server/content';
import {
  createGen2NotificationDispatcher,
  DestinationRegistry,
  type Gen2Destination,
} from '~/features/chat-integration/server/notification';
import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';
import { toArrayFromCsv } from '~/utils/to-array-from-csv';

import {
  prepareSlackMessageForComment,
  prepareSlackMessageForPage,
} from '../../util/slack';
import { growiInfoService } from '../growi-info';

const logger = loggerFactory('growi:service:UserNotificationService');

/**
 * service class of UserNotification
 */
export class UserNotificationService {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
  }

  /**
   * fire user notification
   *
   * @memberof UserNotificationService
   *
   * @param {Page} page
   * @param {User} user
   * @param {string} slackChannelsStr comma separated string. e.g. 'general,channel1,channel2'
   * @param {string} mode 'create' or 'update' or 'comment'
   * @param {{ body: string }} previousRevision
   * @param {Comment} comment
   * @param {Gen2Destination[]} gen2Destinations save-time-selected Gen 2 destinations (Requirement 2.2)
   * @param {boolean} isSlackEnabled whether the caller explicitly requested Gen 1 (Slack) for
   *   this save -- this, not whether slackChannelsStr happens to be empty, decides whether
   *   Gen 1's body below runs at all. Defaults to true so a caller that has not been updated
   *   to pass it keeps this method's original, unconditional-Gen-1 behavior.
   */
  async fire(
    page,
    user,
    slackChannelsStr,
    mode,
    option?: { previousRevision: { body: string } },
    comment: { comment?: string } = {},
    gen2Destinations: Gen2Destination[] = [],
    isSlackEnabled = true,
  ): Promise<PromiseSettledResult<any>[]> {
    const { appService, slackIntegrationService } = this.crowi;
    const siteUrl = growiInfoService.getSiteUrl();

    // Gen 2's save-time destinations dispatch independently of Gen 1's Slack
    // enablement/configuration state (Requirement 12.1, 12.2, 12.3) -- this
    // must run even when Gen 1 was not requested or Slack isn't configured,
    // so it happens before any Gen-1-specific check below. This is 書き留める
    // 契機2 ("編集した人がページの保存時に宛先を指定した通知", tasks.md 8.1) --
    // the SAME chat_notification_outbox as 契機1 (global-notification/index.ts)
    // receives these rows too (design.md "どちらも同じ outbox に入る").
    if (gen2Destinations.length > 0) {
      try {
        const { markdown, containsRestrictedPage } = buildNotificationContent({
          event:
            mode === 'create'
              ? 'pageCreate'
              : mode === 'update'
                ? 'pageEdit'
                : 'comment',
          page: {
            grant: page.grant,
            path: page.path,
            body: page.revision?.body ?? '',
          },
          pageUrl: urljoin(siteUrl, page.id ?? page._id?.toString() ?? ''),
          triggeredByUsername: user.username,
          commentBody: comment.comment,
          previousBody: option?.previousRevision?.body,
        });

        const registry = new DestinationRegistry(gen2Destinations);
        const gen2Results = await registry.dispatchAll(
          createGen2NotificationDispatcher(markdown, containsRestrictedPage),
        );
        // `dispatchAll` swallows each destination's own exception (so one bad
        // destination cannot stop the others) and reports it as a 'failed'
        // outcome instead of rethrowing -- without this loop, a failure here
        // (e.g. the outbox write itself failing) would leave no outbox row AND
        // no log line, making the notification vanish with no trace anywhere.
        for (const gen2Result of gen2Results) {
          if (gen2Result.outcome === 'failed') {
            logger.error(
              {
                relationId: gen2Result.destination.relationId,
                platform: gen2Result.destination.platform,
                channelId: gen2Result.destination.channelId,
              },
              'Gen 2 destination dispatch failed',
            );
          }
        }
      } catch (err) {
        logger.error('Gen 2 user notification dispatch failed', err);
      }
    }

    // Gen 1 was not requested for this save -- Gen 2 (above) has already
    // run, so there is nothing left to do. This is keyed on the caller's
    // explicit isSlackEnabled flag, not on whether slackChannelsStr happens
    // to be empty: a caller that DID request Gen 1 with an empty channel
    // string must still fall through to the unconditional
    // page.updateSlackChannels() call below, which clears a stale value
    // instead of leaving it untouched.
    if (!isSlackEnabled) {
      return [];
    }

    if (!slackIntegrationService.isSlackConfigured) {
      throw new Error('slackIntegrationService has not been set up');
    }

    // update slackChannels attribute asynchronously -- unconditional,
    // regardless of whether slackChannelsStr is empty (an empty string here
    // means the user cleared the field and that must be persisted).
    page.updateSlackChannels(slackChannelsStr);

    // "dev,slacktest" => [dev,slacktest]
    const slackChannels: (string | null)[] = toArrayFromCsv(slackChannelsStr);

    const { previousRevision } = option ?? {};

    const appTitle = appService.getAppTitle();

    const promises = slackChannels.map(async (chan) => {
      // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
      let messageObj;
      if (mode === 'comment') {
        messageObj = prepareSlackMessageForComment(
          comment,
          user,
          appTitle,
          siteUrl,
          chan,
          page.path,
        );
      } else {
        messageObj = prepareSlackMessageForPage(
          page,
          user,
          appTitle,
          siteUrl,
          chan,
          mode,
          previousRevision,
        );
      }

      return slackIntegrationService.postMessage(messageObj);
    });

    return Promise.allSettled(promises);
  }
}
