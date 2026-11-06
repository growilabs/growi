import { getIdStringForRef, type IUserHasId } from '@growi/core';
import { pagePathUtils } from '@growi/core/dist/utils';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { deleteCompletelyUserHomeBySystem } from './delete-completely-user-home-by-system';
import type { IPageService } from './page-service';

const logger = loggerFactory('growi:services:page');

/**
 * Makes sure the user's homepage exists and is owned by the user. A homepage
 * left at that path by someone else (e.g. a former user with the same
 * username) is deleted completely and recreated.
 */
export const ensureUserHomepage = async (
  user: IUserHasId,
  pageService: IPageService,
): Promise<void> => {
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
    await deleteCompletelyUserHomeBySystem(userHomepagePath, pageService);
    page = null;
  }

  if (page == null) {
    const body = `# ${user.username}\nThis is ${user.username}'s page`;

    await pageService.create(userHomepagePath, body, user, {});
    logger.debug({ userHomepagePath }, 'User page created');
  }
};
