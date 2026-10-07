import type { IPage } from '@growi/core';
import { isTopPage } from '@growi/core/dist/utils/page-path-utils';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';

export const shouldUseV4Process = (page: IPage): boolean => {
  const Page = mongoose.model<IPage, PageModel>('Page');

  const isTrashPage = page.status === Page.STATUS_DELETED;
  const isPageMigrated = page.parent != null;
  const isV5Compatible = configManager.getConfig('app:isV5Compatible');
  const isRoot = isTopPage(page.path);
  const isPageRestricted = page.grant === Page.GRANT_RESTRICTED;

  const shouldUseV4Process =
    !isRoot &&
    (!isV5Compatible || !isPageMigrated || isTrashPage || isPageRestricted);

  return shouldUseV4Process;
};
