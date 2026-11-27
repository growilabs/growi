import EventEmitter from 'node:events';
import type { IPage, IUserHasId } from '@growi/core';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';

const logger = loggerFactory('growi:events:page');

/**
 * Third argument of the 'update' event: the grant state the page had before
 * the update was applied.
 */
export interface PageUpdateEventExtras {
  previousGrant: IPage['grant'];
  previousGrantedGroups: IPage['grantedGroups'];
  previousGrantedUsers: IPage['grantedUsers'];
}

/**
 * Fourth argument of the 'updateMany' event that PageService emits for every
 * batch of descendants it renames. The pages in the event still carry their
 * pre-rename paths. Both prefixes are page paths without a trailing slash.
 */
export type PageUpdateManyEventExtras =
  | {
      /** Every page on the page tree under oldPagePathPrefix was renamed (v5). */
      readonly scope: 'subtree';
      readonly oldPagePathPrefix: string;
      readonly newPagePathPrefix: string;
      /**
       * The same object for every batch of one rename operation, a new one
       * per operation, so subscribers can tell which batches belong together.
       */
      readonly operation: object;
    }
  | {
      /**
       * Only the pages in this event were renamed: the v4 process skips the
       * descendants the operating user may not edit.
       */
      readonly scope: 'listed-pages';
      readonly oldPagePathPrefix: string;
      readonly newPagePathPrefix: string;
    };

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
