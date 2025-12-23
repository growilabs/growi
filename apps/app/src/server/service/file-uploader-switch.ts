import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import S2sMessage from '../models/vo/s2s-message';
import { configManager } from './config-manager';
import type { S2sMessagingService } from './s2s-messaging/base';
import type { S2sMessageHandlable } from './s2s-messaging/handlable';

const logger = loggerFactory('growi:service:FileUploaderSwitch');

class FileUploaderSwitch implements S2sMessageHandlable {
  crowi: Crowi;

  s2sMessagingService: S2sMessagingService;

  lastLoadedAt?: Date;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.s2sMessagingService = crowi.s2sMessagingService;
  }

  /**
   * @inheritdoc
   */
  shouldHandleS2sMessage(s2sMessage) {
    const { eventName, updatedAt } = s2sMessage;
    if (eventName !== 'fileUploadServiceUpdated' || updatedAt == null) {
      return false;
    }

    return (
      this.lastLoadedAt == null ||
      this.lastLoadedAt < new Date(s2sMessage.updatedAt)
    );
  }

  /**
   * @inheritdoc
   */
  async handleS2sMessage(s2sMessage) {
    logger.info('Reset fileupload service by pubsub notification');
    await configManager.loadConfigs();
    await this.crowi.setUpFileUpload(true);
  }

  async publishUpdatedMessage() {
    const { s2sMessagingService } = this;

    if (s2sMessagingService != null) {
      const s2sMessage = new S2sMessage('fileUploadServiceUpdated', {
        updatedAt: new Date(),
      });

      try {
        await s2sMessagingService.publish(s2sMessage);
      } catch (e) {
        logger.error(
          'Failed to publish update message with S2sMessagingService: ',
          e.message,
        );
      }
    }
  }
}

module.exports = FileUploaderSwitch;
