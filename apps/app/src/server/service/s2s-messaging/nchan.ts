import path from 'path';

// biome-ignore lint/style/noRestrictedImports: Direct axios usage for external S2S messaging
import axios from 'axios';
import ReconnectingWebSocket from 'reconnecting-websocket';
import WebSocket from 'ws';

import type Crowi from '~/server/crowi';
import loggerFactory from '~/utils/logger';

import S2sMessage from '../../models/vo/s2s-message';

import { AbstractS2sMessagingService } from './base';

const logger = loggerFactory('growi:service:s2s-messaging:nchan');


class NchanDelegator extends AbstractS2sMessagingService {

  /**
   * A list of S2sMessageHandlable instance
   */
  handlableToEventListenerMap: any = {};

  socket: any = null;

  constructor(uri, private publishPath: string, private subscribePath: string, private channelId: any) {
    super(uri);
  }

  /**
   * @inheritdoc
   */
  shouldResubscribe() {
    return this.socket.readyState === ReconnectingWebSocket.CLOSED;
  }

  /**
   * @inheritdoc
   */
  subscribe(forceReconnect = false) {
    if (forceReconnect) {
      logger.info('Force reconnecting is requested. Try to reconnect...');
    }
    else if (this.socket != null && this.shouldResubscribe()) {
      logger.info('The connection to config pubsub server is offline. Try to reconnect...');
    }

    // init client
    if (this.socket == null) {
      this.initClient();
    }

    // connect
    if (forceReconnect || this.shouldResubscribe()) {
      this.socket.reconnect();
    }
  }

  /**
   * @inheritdoc
   */
  override async publish(s2sMessage: S2sMessage): Promise<void> {
    await super.publish(s2sMessage);

    const url = this.constructUrl(this.publishPath).toString();

    logger.debug('Publish message', s2sMessage, `to ${url}`);

    return axios.post(url, s2sMessage);
  }

  /**
   * @inheritdoc
   */
  override addMessageHandler(handlable) {
    if (this.socket == null) {
      logger.error('socket has not initialized yet.');
      return;
    }

    super.addMessageHandler(handlable);
    this.registerMessageHandlerToSocket(handlable);
  }

  /**
   * @inheritdoc
   */
  override removeMessageHandler(handlable) {
    if (this.socket == null) {
      logger.error('socket has not initialized yet.');
      return;
    }

    super.removeMessageHandler(handlable);

    const eventListener = this.handlableToEventListenerMap[handlable];
    if (eventListener != null) {
      this.socket.removeEventListener('message', eventListener);
      delete this.handlableToEventListenerMap[handlable];
    }
  }

  registerMessageHandlerToSocket(handlable) {
    const eventListener = (messageObj) => {
      this.handleMessage(messageObj, handlable);
    };

    this.socket.addEventListener('message', eventListener);
    this.handlableToEventListenerMap[handlable] = eventListener;
  }

  constructUrl(basepath) {
    const pathname = this.channelId == null
      ? basepath //                                 /pubsub
      : path.join(basepath, this.channelId); //     /pubsub/my-channel-id

    return new URL(pathname, this.uri);
  }

  initClient() {
    // const client = new WebSocketClient();
    const url = this.constructUrl(this.publishPath).toString();
    const socket = new ReconnectingWebSocket(url, [], {
      WebSocket,
      maxRetries: 3,
      startClosed: true,
    });

    socket.addEventListener('close', () => {
      logger.info('WebSocket client disconnected');
    });
    socket.addEventListener('error', (error) => {
      logger.error('WebSocket error occured:', error.message);
    });

    socket.addEventListener('open', () => {
      logger.info('WebSocket client connected.');
    });

    this.handlableList.forEach(handlable => this.registerMessageHandlerToSocket(handlable));

    this.socket = socket;
  }

  /**
   * Handle message string with the specified S2sMessageHandlable
   *
   * @see https://github.com/theturtle32/WebSocket-Node/blob/1f7ffba2f7a6f9473bcb39228264380ce2772ba7/docs/WebSocketConnection.md#message
   *
   * @param {object} message WebSocket-Node message object
   * @param {S2sMessageHandlable} handlable
   */
  handleMessage(message, handlable) {
    try {
      const s2sMessage = S2sMessage.parse(message.data);

      // check uid
      if (s2sMessage.publisherUid === this.uid) {
        logger.debug(`Skip processing by ${handlable.constructor.name} because this message is sent by the publisher itself:`, `from ${this.uid}`);
        return;
      }

      // check shouldHandleS2sMessage
      const shouldHandle = handlable.shouldHandleS2sMessage(s2sMessage);
      logger.debug(`${handlable.constructor.name}.shouldHandleS2sMessage(`, s2sMessage, `) => ${shouldHandle}`);

      if (shouldHandle) {
        handlable.handleS2sMessage(s2sMessage);
      }
    }
    catch (err) {
      logger.warn('Could not handle a message: ', err.message);
    }
  }

}

module.exports = function(crowi: Crowi) {
  const { configManager } = crowi;

  const uri = configManager.getConfig('app:nchanUri');

  // when nachan server URI is not set
  if (uri == null) {
    logger.warn('NCHAN_URI is not specified.');
    return;
  }

  const publishPath = configManager.getConfig('s2sMessagingPubsub:nchan:publishPath');
  const subscribePath = configManager.getConfig('s2sMessagingPubsub:nchan:subscribePath');
  const channelId = configManager.getConfig('s2sMessagingPubsub:nchan:channelId');

  return new NchanDelegator(uri, publishPath, subscribePath, channelId);
};
