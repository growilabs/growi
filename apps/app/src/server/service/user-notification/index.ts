import type { IRevisionHasId } from '@growi/core';

import type Crowi from '~/server/crowi';
import { toArrayFromCsv } from '~/utils/to-array-from-csv';

import {
  prepareSlackMessageForComment,
  prepareSlackMessageForPage,
} from '../../util/slack';
import { growiInfoService } from '../growi-info';

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
   * @param {IRevisionHasId} previousRevision
   * @param {Comment} comment
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async fire(
    page,
    user,
    slackChannelsStr,
    mode,
    option?: { previousRevision: IRevisionHasId },
    comment = {},
  ): Promise<PromiseSettledResult<any>[]> {
    const { appService, slackIntegrationService } = this.crowi;

    if (!slackIntegrationService.isSlackConfigured) {
      throw new Error('slackIntegrationService has not been set up');
    }

    // update slackChannels attribute asynchronously
    page.updateSlackChannels(slackChannelsStr);

    const { previousRevision } = option ?? {};

    // "dev,slacktest" => [dev,slacktest]
    const slackChannels: (string | null)[] = toArrayFromCsv(slackChannelsStr);

    const appTitle = appService.getAppTitle();
    const siteUrl = growiInfoService.getSiteUrl();

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
