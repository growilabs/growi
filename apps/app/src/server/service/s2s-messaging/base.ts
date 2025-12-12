import crypto from 'crypto';

import type S2sMessage from '~/server/models/vo/s2s-message';
import loggerFactory from '~/utils/logger';

import type { S2sMessageHandlable } from './handlable';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('growi:service:s2s-messaging:base');

export interface S2sMessagingService {
  uid: number;

  uri: string;

  handlableList: S2sMessageHandlable[];

  shouldResubscribe(): boolean;

  subscribe(forceReconnect: boolean): void;

  /**
   * Publish message
   * @param s2sMessage
   */
  publish(s2sMessage: S2sMessage): Promise<void>;

  /**
   * Add message handler
   * @param handlable
   */
  addMessageHandler(handlable: S2sMessageHandlable): void;

  /**
   * Remove message handler
   * @param handlable
   */
  removeMessageHandler(handlable: S2sMessageHandlable): void;
}

export abstract class AbstractS2sMessagingService
  implements S2sMessagingService
{
  uid: number;

  uri: string;

  handlableList: S2sMessageHandlable[];

  constructor(uri: string) {
    this.uid = crypto.randomInt(100000);
    this.uri = uri;

    if (uri == null) {
      throw new Error('uri must be set');
    }

    this.handlableList = [];
  }

  abstract shouldResubscribe(): boolean;

  abstract subscribe(forceReconnect: boolean): void;

  /**
   * Publish message
   * @param s2sMessage
   */
  async publish(s2sMessage: S2sMessage): Promise<void> {
    s2sMessage.setPublisherUid(this.uid);
  }

  /**
   * Add message handler
   * @param handlable
   */
  addMessageHandler(handlable: S2sMessageHandlable): void {
    this.handlableList.push(handlable);
  }

  /**
   * Remove message handler
   * @param handlable
   */
  removeMessageHandler(handlable: S2sMessageHandlable): void {
    this.handlableList = this.handlableList.filter((h) => h !== handlable);
  }
}
