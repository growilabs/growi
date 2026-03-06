import { ConfigSource } from '@growi/core/dist/interfaces';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import S2sMessage from '../models/vo/s2s-message';
import { configManager } from './config-manager';
import type { S2sMessagingService } from './s2s-messaging/base';
import type { S2sMessageHandlable } from './s2s-messaging/handlable';

const logger = loggerFactory('growi:service:AppService');
/**
 * the service class of AppService
 */
export default class AppService implements S2sMessageHandlable {
  crowi: Crowi;

  s2sMessagingService: S2sMessagingService;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.s2sMessagingService = crowi.s2sMessagingService;
  }

  /**
   * @inheritdoc
   */
  shouldHandleS2sMessage(s2sMessage) {
    const { eventName } = s2sMessage;
    if (eventName !== 'systemInstalled') {
      return false;
    }

    const isInstalled = configManager.getConfig('app:installed');

    return !isInstalled;
  }

  /**
   * @inheritdoc
   */
  async handleS2sMessage(s2sMessage) {
    logger.info('Invoke post installation process by pubsub notification');

    const isDBInitialized = await this.isDBInitialized(true);
    if (isDBInitialized) {
      this.setupAfterInstall();

      // remove message handler
      const { s2sMessagingService } = this;
      if (s2sMessagingService != null) {
        this.s2sMessagingService.removeMessageHandler(this);
      }
    }
  }

  async publishPostInstallationMessage() {
    const { s2sMessagingService } = this;

    if (s2sMessagingService != null) {
      const s2sMessage = new S2sMessage('systemInstalled');

      try {
        await s2sMessagingService.publish(s2sMessage);
      } catch (e) {
        logger.error(
          'Failed to publish post installation message with S2sMessagingService: ',
          e.message,
        );
      }
    }
  }

  getAppTitle() {
    return configManager.getConfig('app:title') ?? 'GROWI';
  }

  getTzoffset() {
    return -(configManager.getConfig('app:timezone') || 9) * 60;
  }

  getAppConfidential() {
    return configManager.getConfig('app:confidential');
  }

  async isDBInitialized(forceReload) {
    if (forceReload) {
      // load configs
      await configManager.loadConfigs();
    }
    return configManager.getConfig('app:installed', ConfigSource.db);
  }

  async setupAfterInstall(): Promise<void> {
    this.crowi.setupRoutesAtLast();
    this.crowi.setupGlobalErrorHandlers();
  }

  isMaintenanceMode(): boolean {
    return configManager.getConfig('app:isMaintenanceMode');
  }

  async startMaintenanceMode(): Promise<void> {
    await configManager.updateConfig('app:isMaintenanceMode', true);
  }

  async endMaintenanceMode(): Promise<void> {
    await configManager.updateConfig('app:isMaintenanceMode', false);
  }
}
