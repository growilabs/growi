import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

import { S2cMessagePageUpdated } from '../../models/vo/s2c-message';
import S2sMessage from '../../models/vo/s2s-message';
import type { S2sMessagingService } from '../s2s-messaging/base';
import type { S2sMessageHandlable } from '../s2s-messaging/handlable';
import { getRoomNameWithId, RoomPrefix } from '../socket-io/helper';

const logger = loggerFactory(
  'growi:service:system-events:SyncPageStatusService',
);

/**
 * This service notify page status
 *  to clients who are connecting to this server
 *  and also notify to clients connecting to other GROWI servers
 *
 * Sequence:
 *  1. A client A1 connecting to GROWI server A updates a page
 *  2. GROWI server A notify the information
 *    2.1 -- to client A2, A3, ... with SocketIoService
 *    2.2 -- to other GROWI servers with S2sMessagingService
 *  3. GROWI server B, C, ... relay the information to clients B1, B2, .. C1, C2, ... with SocketIoService
 *
 */
class SyncPageStatusService implements S2sMessageHandlable {
  crowi: Crowi;

  s2sMessagingService!: S2sMessagingService;

  socketIoService!: any;

  emitter!: any;

  constructor(crowi: Crowi, s2sMessagingService, socketIoService) {
    this.crowi = crowi;
    this.s2sMessagingService = s2sMessagingService;
    this.socketIoService = socketIoService;

    this.emitter = crowi.events.page;

    this.initSystemEventListeners();
  }

  /**
   * @inheritdoc
   */
  shouldHandleS2sMessage(s2sMessage) {
    const { eventName } = s2sMessage;
    if (eventName !== 'pageStatusUpdated') {
      return false;
    }

    return true;
  }

  /**
   * @inheritdoc
   */
  async handleS2sMessage(s2sMessage) {
    const { socketIoEventName, s2cMessageBody } = s2sMessage;
    const { socketIoService } = this;

    // emit the updated information to clients
    if (socketIoService.isInitialized) {
      socketIoService
        .getDefaultSocket()
        .emit(socketIoEventName, s2cMessageBody);
    }
  }

  async publishToOtherServers(socketIoEventName, s2cMessageBody) {
    const { s2sMessagingService } = this;

    if (s2sMessagingService != null) {
      const s2sMessage = new S2sMessage('pageStatusUpdated', {
        socketIoEventName,
        s2cMessageBody,
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

  initSystemEventListeners() {
    const { socketIoService } = this;

    // register events
    this.emitter.on('create', (page, user) => {
      logger.debug("'create' event emitted.");

      const s2cMessagePageUpdated = new S2cMessagePageUpdated(page, user);

      // emit to the room for each page
      socketIoService
        .getDefaultSocket()
        .in(getRoomNameWithId(RoomPrefix.PAGE, page._id))
        .except(getRoomNameWithId(RoomPrefix.USER, user._id))
        .emit('page:create', { s2cMessagePageUpdated });

      this.publishToOtherServers('page:create', { s2cMessagePageUpdated });
    });
    this.emitter.on('update', (page, user) => {
      logger.debug("'update' event emitted.");

      const s2cMessagePageUpdated = new S2cMessagePageUpdated(page, user);

      // emit to the room for each page
      socketIoService
        .getDefaultSocket()
        .in(getRoomNameWithId(RoomPrefix.PAGE, page._id))
        .except(getRoomNameWithId(RoomPrefix.USER, user._id))
        .emit('page:update', { s2cMessagePageUpdated });

      this.publishToOtherServers('page:update', { s2cMessagePageUpdated });
    });
    this.emitter.on('delete', (page, user) => {
      logger.debug("'delete' event emitted.");

      const s2cMessagePageUpdated = new S2cMessagePageUpdated(page, user);

      // emit to the room for each page
      socketIoService
        .getDefaultSocket()
        .in(getRoomNameWithId(RoomPrefix.PAGE, page._id))
        .except(getRoomNameWithId(RoomPrefix.USER, user._id))
        .emit('page:delete', { s2cMessagePageUpdated });

      this.publishToOtherServers('page:delete', { s2cMessagePageUpdated });
    });
  }
}

module.exports = SyncPageStatusService;
