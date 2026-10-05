import { getIdStringForRef, type IUserHasId } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import EventEmitter from 'events';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import { deleteCompletelyUserHomeBySystem } from '../service/page/delete-completely-user-home-by-system';

const logger = loggerFactory('growi:events:user');

class UserEvent extends EventEmitter {
  crowi: Crowi;

  constructor(crowi: Crowi) {
    super();
    this.crowi = crowi;
  }

  // Never rejects: activation awaits this, and a failure to set up the home
  // page must not fail the activation itself.
  async onActivated(user: IUserHasId): Promise<void> {
    try {
      const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
        'Page',
      );
      const userHomepagePath = pagePathUtils.userHomepagePath(user);

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
        logger.debug({ page }, 'User page created');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to create user page');
    }
  }
}

export default UserEvent;
