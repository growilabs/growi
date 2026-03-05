import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import {
  apiv3Delete,
  apiv3Get,
  apiv3Post,
  apiv3Put,
} from '../util/apiv3-client';

/**
 * Service container for admin Notification setting page (NotificationSetting.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminNotificationContainer extends Container {
  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.appContainer = appContainer;

    this.state = {
      retrieveError: null,

      isSlackbotConfigured: null,
      isSlackLegacyConfigured: null,
      currentBotType: null,

      userNotifications: [],
      isNotificationForOwnerPageEnabled: false,
      isNotificationForGroupPageEnabled: false,
      globalNotifications: [],
    };
  }

  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminNotificationContainer';
  }

  /**
   * Retrieve notificationData
   */
  async retrieveNotificationData() {
    const response = await apiv3Get('/notification-setting/');
    const { notificationParams } = response.data;

    this.setState({
      isSlackbotConfigured: notificationParams.isSlackbotConfigured,
      isSlackLegacyConfigured: notificationParams.isSlackLegacyConfigured,
      currentBotType: notificationParams.currentBotType,

      userNotifications: notificationParams.userNotifications,
      isNotificationForOwnerPageEnabled:
        notificationParams.isNotificationForOwnerPageEnabled,
      isNotificationForGroupPageEnabled:
        notificationParams.isNotificationForGroupPageEnabled,
      globalNotifications: notificationParams.globalNotifications,
    });
  }

  /**
   * Update slackAppConfiguration
   * @memberOf SlackAppConfiguration
   */
  async updateSlackAppConfiguration() {
    const response = await apiv3Put(
      '/notification-setting/slack-configuration',
      {
        webhookUrl: this.state.webhookUrl,
        isIncomingWebhookPrioritized: this.state.isIncomingWebhookPrioritized,
        slackToken: this.state.slackToken,
      },
    );

    return response;
  }

  /**
   * Add notificationPattern
   * @memberOf SlackAppConfiguration
   */
  async addNotificationPattern(pathPattern, channel) {
    const response = await apiv3Post(
      '/notification-setting/user-notification',
      {
        pathPattern,
        channel,
      },
    );

    this.setState({
      userNotifications: response.data.responseParams.userNotifications,
    });
  }

  /**
   * Delete user trigger notification pattern
   */
  async deleteUserTriggerNotificationPattern(notificatiionId) {
    const response = await apiv3Delete(
      `/notification-setting/user-notification/${notificatiionId}`,
    );
    const deletedNotificaton = response.data;
    await this.retrieveNotificationData();
    return deletedNotificaton;
  }

  /**
   * Switch isNotificationForOwnerPageEnabled
   */
  switchIsNotificationForOwnerPageEnabled() {
    this.setState({
      isNotificationForOwnerPageEnabled:
        !this.state.isNotificationForOwnerPageEnabled,
    });
  }

  /**
   * Switch isNotificationForGroupPageEnabled
   */
  switchIsNotificationForGroupPageEnabled() {
    this.setState({
      isNotificationForGroupPageEnabled:
        !this.state.isNotificationForGroupPageEnabled,
    });
  }

  /**
   * Update globalNotificationForPages
   * @memberOf SlackAppConfiguration
   */
  async updateGlobalNotificationForPages() {
    const response = await apiv3Put(
      '/notification-setting/notify-for-page-grant/',
      {
        isNotificationForOwnerPageEnabled:
          this.state.isNotificationForOwnerPageEnabled,
        isNotificationForGroupPageEnabled:
          this.state.isNotificationForGroupPageEnabled,
      },
    );

    return response;
  }

  /**
   * Delete global notification pattern
   */
  async deleteGlobalNotificationPattern(notificatiionId) {
    const response = await apiv3Delete(
      `/notification-setting/global-notification/${notificatiionId}`,
    );
    const deletedNotificaton = response.data;
    await this.retrieveNotificationData();
    return deletedNotificaton;
  }
}
