import EventEmitter from 'node:events';
import type { IPage, IUserHasId } from '@growi/core';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';

const logger = loggerFactory('growi:events:page');

class PageEvent extends EventEmitter {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }

  onCreate(_page: IPage, _user: IUserHasId): void {
    logger.debug('onCreate event fired');
  }

  onUpdate(_page: IPage, _user: IUserHasId): void {
    logger.debug('onUpdate event fired');
  }

  onCreateMany(_pages: IPage[], _user: IUserHasId): void {
    logger.debug('onCreateMany event fired');
  }

  onAddSeenUsers(_pages: IPage[], _user: IUserHasId): void {
    logger.debug('onAddSeenUsers event fired');
  }
}

export default PageEvent;
