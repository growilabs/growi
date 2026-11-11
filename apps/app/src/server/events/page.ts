import EventEmitter from 'node:events';
import type { IPage, IUserHasId } from '@growi/core';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';

const logger = loggerFactory('growi:events:page');

/**
 * Emitted with the same arguments as 'update' when an update saved the page,
 * grant included, but failed before it could emit 'update' (e.g. the body
 * write lost a revision conflict). The page is re-read, so it carries what is
 * stored now.
 */
export const PAGE_EVENT_UPDATE_ABORTED_AFTER_SAVE = 'updateAbortedAfterSave';

/**
 * Third argument of the 'update' and 'updateAbortedAfterSave' events: the
 * grant state the page had before the update was applied.
 */
export interface PageUpdateEventExtras {
  previousGrant: IPage['grant'];
  previousGrantedGroups: IPage['grantedGroups'];
  previousGrantedUsers: IPage['grantedUsers'];
}

/**
 * Must be called before the update touches the page's grant fields: the arrays
 * are copied because the update replaces them on the same document.
 */
export const capturePreviousGrantState = (
  page: Pick<IPage, 'grant' | 'grantedGroups' | 'grantedUsers'>,
): PageUpdateEventExtras => ({
  previousGrant: page.grant,
  previousGrantedGroups: [...(page.grantedGroups ?? [])],
  previousGrantedUsers: [...(page.grantedUsers ?? [])],
});

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
