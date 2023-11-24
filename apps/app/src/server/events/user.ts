import EventEmitter from 'events';

import type { IUserHasId } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:events:user');

class UserEvent extends EventEmitter {

  crowi: any;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  constructor(crowi: any) {
    super();
    this.crowi = crowi;
  }

  async onActivated(user: IUserHasId): Promise<void> {
    if (this.crowi.pageService === null) {
      logger.warn('crowi pageService is null');
      return;
    }

    const Page = mongoose.model('Page') as unknown as PageModel;
    const userHomepagePath = pagePathUtils.userHomepagePath(user);

    let page = await Page.findByPath(userHomepagePath, true);

    // TODO: Make it more type safe
    // Since the type of page.creator is 'any', we resort to the following comparison,
    // checking if page.creator.toString() is not equal to user._id.toString(). Our code covers null, string, or object types.
    if (page != null && page.creator != null && page.creator.toString() !== user._id.toString()) {
      await this.crowi.pageService.deleteCompletelyUserHomeBySystem(userHomepagePath);
      page = null;
    }

    if (page == null) {
      const body = `# ${user.username}\nThis is ${user.username}'s page`;

      try {
        await this.crowi.pageService.create(userHomepagePath, body, user, {});
        logger.debug('User page created', page);
      }
      catch (err) {
        logger.error('Failed to create user page', err);
      }
    }
  }

}

export default UserEvent;
