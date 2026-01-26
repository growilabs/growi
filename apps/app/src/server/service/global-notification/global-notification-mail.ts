import nodePath from 'node:path';
import type { IUser } from '@growi/core/dist/interfaces';

import type Crowi from '~/server/crowi';
import {
  GlobalNotificationSettingEvent,
  type GlobalNotificationSettingModel,
  GlobalNotificationSettingType,
} from '~/server/models/GlobalNotificationSetting';
import type { PageDocument } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { growiInfoService } from '~/server/service/growi-info';
import loggerFactory from '~/utils/logger';

import type { GlobalNotificationEventVars } from './types';

const _logger = loggerFactory('growi:service:GlobalNotificationMailService');

interface MailOption {
  subject: string;
  template: string;
  vars: Record<string, unknown>;
}

/**
 * sub service class of GlobalNotificationSetting
 */
class GlobalNotificationMailService {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
  }

  /**
   * send mail global notification
   *
   * @memberof GlobalNotificationMailService
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
    vars: GlobalNotificationEventVars,
  ): Promise<void> {
    const { mailService } = this.crowi;

    const GlobalNotificationSetting = this.crowi.models
      .GlobalNotificationSetting as GlobalNotificationSettingModel;
    const notifications =
      await GlobalNotificationSetting.findSettingByPathAndEvent(
        event,
        page.path,
        GlobalNotificationSettingType.MAIL,
      );

    const option = this.generateOption(event, page, triggeredBy, vars);

    await Promise.all(
      notifications.map((notification) => {
        return mailService?.send({
          ...option,
          to: notification.toEmail,
        });
      }),
    );
  }

  /**
   * fire global notification
   *
   * @memberof GlobalNotificationMailService
   *
   * @param event event name triggered
   * @param page path triggered the event
   * @param triggeredBy user triggered the event
   * @param vars event specific vars
   *
   * @return {{ subject: string, template: string, vars: object }}
   */
  generateOption(
    event: string,
    page: PageDocument,
    triggeredBy: IUser,
    { comment, oldPath }: GlobalNotificationEventVars,
  ): MailOption {
    const locale = configManager.getConfig('app:globalLang');
    // validate for all events
    if (event == null || page == null || triggeredBy == null) {
      throw new Error(
        `invalid vars supplied to GlobalNotificationMailService.generateOption for event ${event}`,
      );
    }

    const template = nodePath.join(
      this.crowi.localeDir,
      `${locale}/notifications/${event}.ejs`,
    );

    const path = page.path;
    const appTitle = this.crowi.appService.getAppTitle();
    const siteUrl = growiInfoService.getSiteUrl();
    const pageUrl = new URL(page._id?.toString() ?? '', siteUrl);

    let subject: string;
    let vars: Record<string, unknown> = {
      appTitle,
      siteUrl,
      path,
      username: triggeredBy.username,
    };

    switch (event) {
      case GlobalNotificationSettingEvent.PAGE_CREATE:
        subject = `#${event} - ${triggeredBy.username} created ${path} at URL: ${pageUrl}`;
        break;

      case GlobalNotificationSettingEvent.PAGE_EDIT:
        subject = `#${event} - ${triggeredBy.username} edited ${path} at URL: ${pageUrl}`;
        break;

      case GlobalNotificationSettingEvent.PAGE_DELETE:
        subject = `#${event} - ${triggeredBy.username} deleted ${path} at URL: ${pageUrl}`;
        break;

      case GlobalNotificationSettingEvent.PAGE_MOVE:
        // validate for page move
        if (oldPath == null) {
          throw new Error(
            `invalid vars supplied to GlobalNotificationMailService.generateOption for event ${event}`,
          );
        }

        subject = `#${event} - ${triggeredBy.username} moved ${oldPath} to ${path} at URL: ${pageUrl}`;
        vars = {
          ...vars,
          oldPath,
          newPath: path,
        };
        break;

      case GlobalNotificationSettingEvent.PAGE_LIKE:
        subject = `#${event} - ${triggeredBy.username} liked ${path} at URL: ${pageUrl}`;
        break;

      case GlobalNotificationSettingEvent.COMMENT:
        // validate for comment
        if (comment == null) {
          throw new Error(
            `invalid vars supplied to GlobalNotificationMailService.generateOption for event ${event}`,
          );
        }

        subject = `#${event} - ${triggeredBy.username} commented on ${path} at URL: ${pageUrl}`;
        vars = {
          ...vars,
          comment: comment.comment,
        };
        break;

      default:
        throw new Error(`unknown global notificaiton event: ${event}`);
    }

    return {
      subject,
      template,
      vars,
    };
  }
}

export { GlobalNotificationMailService };
