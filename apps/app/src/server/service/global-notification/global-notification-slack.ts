import type { IUser } from '@growi/core/dist/interfaces';
import { pagePathUtils } from '@growi/core/dist/utils';
import type { ChatPostMessageArguments } from '@slack/web-api';
import urljoin from 'url-join';

import type Crowi from '~/server/crowi';
import {
  GlobalNotificationSettingEvent,
  type GlobalNotificationSettingModel,
  GlobalNotificationSettingType,
} from '~/server/models/GlobalNotificationSetting';
import loggerFactory from '~/utils/logger';

import { prepareSlackMessageForGlobalNotification } from '../../util/slack';
import { growiInfoService } from '../growi-info';
import type { GlobalNotificationEventVars } from './types';

const _logger = loggerFactory('growi:service:GlobalNotificationSlackService');

const { encodeSpaces } = pagePathUtils;

/**
 * sub service class of GlobalNotificationSetting
 */
class GlobalNotificationSlackService {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
  }

  /**
   * send slack global notification
   *
   * @memberof GlobalNotificationSlackService
   *
   * @param event event name
   * @param id page id
   * @param path page path
   * @param triggeredBy user who triggered the event
   * @param vars event specific vars
   */

  // biome-ignore lint/nursery/useMaxParams: ignore
  async fire(
    event: string,
    id: string,
    path: string,
    triggeredBy: IUser,
    vars: GlobalNotificationEventVars,
  ): Promise<void> {
    const { appService, slackIntegrationService } = this.crowi;

    const GlobalNotificationSetting = this.crowi.models
      .GlobalNotificationSetting as GlobalNotificationSettingModel;
    const notifications =
      await GlobalNotificationSetting.findSettingByPathAndEvent(
        event,
        path,
        GlobalNotificationSettingType.SLACK,
      );

    const messageBody = this.generateMessageBody(
      event,
      id,
      path,
      triggeredBy,
      vars,
    );
    const attachmentBody = this.generateAttachmentBody(
      event,
      id,
      path,
      triggeredBy,
      vars,
    );

    const appTitle = appService.getAppTitle();

    await Promise.all(
      notifications.map((notification) => {
        const messageObj = prepareSlackMessageForGlobalNotification(
          messageBody,
          attachmentBody,
          appTitle,
          notification.slackChannels,
        );
        return slackIntegrationService.postMessage(
          messageObj as unknown as ChatPostMessageArguments,
        );
      }),
    );
  }

  /**
   * generate slack message body
   *
   * @memberof GlobalNotificationSlackService
   *
   * @param event event name triggered
   * @param id page id
   * @param path path triggered the event
   * @param triggeredBy user triggered the event
   * @param vars event specific vars
   *
   * @return slack message body
   */
  // biome-ignore lint/nursery/useMaxParams: event vars needed for different notification types
  generateMessageBody(
    event: string,
    id: string,
    path: string,
    triggeredBy: IUser,
    { comment, oldPath }: GlobalNotificationEventVars,
  ): string {
    const siteUrl = growiInfoService.getSiteUrl();
    const parmaLink = `<${urljoin(siteUrl, id)}|${path}>`;
    const pathLink = `<${urljoin(siteUrl, encodeSpaces(path) ?? '')}|${path}>`;
    const username = `<${urljoin(siteUrl, 'user', triggeredBy.username)}|${triggeredBy.username}>`;
    let messageBody: string;

    switch (event) {
      case GlobalNotificationSettingEvent.PAGE_CREATE:
        messageBody = `:bell: ${username} created ${parmaLink}`;
        break;
      case GlobalNotificationSettingEvent.PAGE_EDIT:
        messageBody = `:bell: ${username} edited ${parmaLink}`;
        break;
      case GlobalNotificationSettingEvent.PAGE_DELETE:
        messageBody = `:bell: ${username} deleted ${pathLink}`;
        break;
      case GlobalNotificationSettingEvent.PAGE_MOVE:
        // validate for page move
        if (oldPath == null) {
          throw new Error(
            `invalid vars supplied to GlobalNotificationSlackService.generateOption for event ${event}`,
          );
        }
        messageBody = `:bell: ${username} moved ${oldPath} to ${parmaLink}`;
        break;
      case GlobalNotificationSettingEvent.PAGE_LIKE:
        messageBody = `:bell: ${username} liked ${parmaLink}`;
        break;
      case GlobalNotificationSettingEvent.COMMENT:
        // validate for comment
        if (comment == null) {
          throw new Error(
            `invalid vars supplied to GlobalNotificationSlackService.generateOption for event ${event}`,
          );
        }
        messageBody = `:bell: ${username} commented on ${parmaLink}`;
        break;
      default:
        throw new Error(`unknown global notificaiton event: ${event}`);
    }

    return messageBody;
  }

  /**
   * generate slack attachment body
   *
   * @memberof GlobalNotificationSlackService
   *
   * @param event event name triggered
   * @param id page id
   * @param path path triggered the event
   * @param triggeredBy user triggered the event
   * @param vars event specific vars
   *
   * @return slack attachment body
   */
  // biome-ignore lint/nursery/useMaxParams: event vars needed for different notification types
  generateAttachmentBody(
    _event: string,
    _id: string,
    _path: string,
    _triggeredBy: IUser,
    _vars: GlobalNotificationEventVars,
  ): string {
    const attachmentBody = '';

    // TODO: create attachment
    // attachment body is intended for comment or page diff

    // switch (event) {
    //   case GlobalNotificationSettingEvent.PAGE_CREATE:
    //     break;
    //   case GlobalNotificationSettingEvent.PAGE_EDIT:
    //     break;
    //   case GlobalNotificationSettingEvent.PAGE_DELETE:
    //     break;
    //   case GlobalNotificationSettingEvent.PAGE_MOVE:
    //     break;
    //   case GlobalNotificationSettingEvent.PAGE_LIKE:
    //     break;
    //   case GlobalNotificationSettingEvent.COMMENT:
    //     break;
    //   default:
    //     throw new Error(`unknown global notificaiton event: ${event}`);
    // }

    return attachmentBody;
  }
}

export { GlobalNotificationSlackService };
