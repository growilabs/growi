import { isServer } from '@growi/core/dist/utils';
import { Container } from 'unstated';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

/**
 * Service container for admin LegacySlackIntegration setting page (LegacySlackIntegration.jsx)
 * @extends {Container} unstated Container
 */
export default class AdminSlackIntegrationLegacyContainer extends Container {
  constructor(appContainer) {
    super();

    if (isServer()) {
      return;
    }

    this.appContainer = appContainer;

    this.state = {
      isSlackbotConfigured: false,
      retrieveError: null,
      selectSlackOption: 'Incoming Webhooks',
      webhookUrl: '',
      isIncomingWebhookPrioritized: false,
      slackToken: '',
    };
  }

  /**
   * Workaround for the mangling in production build to break constructor.name
   */
  static getClassName() {
    return 'AdminSlackIntegrationLegacyContainer';
  }

  /**
   * Retrieve notificationData
   */
  async retrieveData() {
    const response = await apiv3Get('/slack-integration-legacy-settings/');
    const { slackIntegrationParams } = response.data;

    this.setState({
      isSlackbotConfigured: slackIntegrationParams.isSlackbotConfigured,
      webhookUrl: slackIntegrationParams.webhookUrl,
      isIncomingWebhookPrioritized:
        slackIntegrationParams.isIncomingWebhookPrioritized,
      slackToken: slackIntegrationParams.slackToken,
    });
  }

  /**
   * Switch slackOption
   */
  switchSlackOption(slackOption) {
    this.setState({ selectSlackOption: slackOption });
  }

  /**
   * Change webhookUrl
   */
  changeWebhookUrl(webhookUrl) {
    this.setState({ webhookUrl });
  }

  /**
   * Switch incomingWebhookPrioritized
   */
  switchIsIncomingWebhookPrioritized() {
    this.setState({
      isIncomingWebhookPrioritized: !this.state.isIncomingWebhookPrioritized,
    });
  }

  /**
   * Change slackToken
   */
  changeSlackToken(slackToken) {
    this.setState({ slackToken });
  }

  /**
   * Update slackAppConfiguration
   * @memberOf SlackAppConfiguration
   */
  async updateSlackAppConfiguration() {
    const response = await apiv3Put('/slack-integration-legacy-settings/', {
      webhookUrl: this.state.webhookUrl,
      isIncomingWebhookPrioritized: this.state.isIncomingWebhookPrioritized,
      slackToken: this.state.slackToken,
    });

    return response;
  }
}
