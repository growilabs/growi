import { PageGrant } from '@growi/core';
import type { IUser } from '@growi/core/dist/interfaces';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { GlobalNotificationMailService } from './global-notification-mail';
import { GlobalNotificationSlackService } from './global-notification-slack';
import type { GlobalNotificationEventVars } from './types';

const logger = loggerFactory('growi:service:GlobalNotificationService');

/**
 * service class of GlobalNotificationSetting
 */
class GlobalNotificationService {
  crowi: Crowi;

  defaultLang: string;

  globalNotificationMailService: GlobalNotificationMailService;

  globalNotificationSlackService: GlobalNotificationSlackService;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.defaultLang = 'en_US'; // TODO: get defaultLang from app global config

    this.globalNotificationMailService = new GlobalNotificationMailService(
      crowi,
    );
    this.globalNotificationSlackService = new GlobalNotificationSlackService(
      crowi,
    );
  }

  /**
   * fire global notification
   *
   * @memberof GlobalNotificationService
   *
   * @param event event name triggered
   * @param page page triggered the event
   * @param triggeredBy user who triggered the event
   * @param vars event specific vars
   */
  async fire(
    event: string,
    page: PageDocument,
    triggeredBy: IUser,
    vars: GlobalNotificationEventVars = {},
  ): Promise<void> {
    logger.debug(`global notficatoin event ${event} was triggered`);

    // validation
    if (event == null || page.path == null || triggeredBy == null) {
      throw new Error(
        `invalid vars supplied to GlobalNotificationSlackService.generateOption for event ${event}`,
      );
    }

    if (!this.isSendNotification(page.grant)) {
      logger.info('this page does not send notifications');
      return;
    }

    await Promise.all([
      this.globalNotificationMailService.fire(event, page, triggeredBy, vars),
      this.globalNotificationSlackService.fire(
        event,
        page.id ?? page._id?.toString(),
        page.path,
        triggeredBy,
        vars,
      ),
    ]);
  }

  /**
   * fire global notification
   *
   * @memberof GlobalNotificationService
   *
   * @param grant page grant
   * @return isSendNotification
   */
  isSendNotification(grant: number): boolean {
    switch (grant) {
      case PageGrant.GRANT_PUBLIC:
        return true;
      case PageGrant.GRANT_RESTRICTED:
        return false;
      case PageGrant.GRANT_SPECIFIED:
        return false;
      case PageGrant.GRANT_OWNER:
        return (
          this.crowi.configManager.getConfig(
            'notification:owner-page:isEnabled',
          ) ?? false
        );
      case PageGrant.GRANT_USER_GROUP:
        return (
          this.crowi.configManager.getConfig(
            'notification:group-page:isEnabled',
          ) ?? false
        );
      default:
        return false;
    }
  }
}

export { GlobalNotificationService };
