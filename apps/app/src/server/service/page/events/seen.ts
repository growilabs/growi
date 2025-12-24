import type { IUserHasId } from '@growi/core/dist/interfaces';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:events:page:seen');

export const onSeen = async (
  pageId: string,
  user: IUserHasId,
): Promise<void> => {
  if (pageId == null || user == null) {
    logger.warn('onSeen: pageId or user is null');
    return;
  }

  try {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );

    const page = await Page.findById(pageId);

    if (page == null) {
      logger.warn('onSeen: page not found', { pageId });
      return;
    }

    await page.seen(user);
    logger.debug('onSeen: successfully marked page as seen', { pageId });
  } catch (err) {
    logger.error('onSeen: failed to mark page as seen', err);
  }
};
