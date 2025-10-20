import { getIdStringForRef, type IUserHasId } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import EventEmitter from 'events';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { deleteCompletelyUserHomeBySystem } from '../service/page/delete-completely-user-home-by-system';

const logger = loggerFactory('growi:events:user');

class UserEvent extends EventEmitter {
  crowi: any;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  constructor(crowi: any) {
    super();
    this.crowi = crowi;
  }

  async onActivated(user: IUserHasId): Promise<void> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );
    const userHomepagePath = pagePathUtils.userHomepagePath(user);

    try {
      let page: HydratedDocument<PageDocument> | null = await Page.findByPath(
        userHomepagePath,
        true,
      );

      if (
        page != null &&
        page.creator != null &&
        getIdStringForRef(page.creator) !== user._id.toString()
      ) {
        await deleteCompletelyUserHomeBySystem(
          userHomepagePath,
          this.crowi.pageService,
        );
        page = null;
      }

      if (page == null) {
        const body = `# ${user.username}\nThis is ${user.username}'s page`;

        await this.crowi.pageService.create(userHomepagePath, body, user, {});
        logger.debug('User page created', page);
      }
    } catch (err) {
      logger.error('Failed to create user page', err);
    }
  }
}

export default UserEvent;
