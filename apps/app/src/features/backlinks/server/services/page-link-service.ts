import type { IUser, IUserHasId } from '@growi/core';
import type { HydratedDocument, Types } from 'mongoose';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { PageQueryBuilder } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { IBacklink } from '../../interfaces/page-link';
import PageLink from '../models/page-link';
import { handlePageUpsert } from './page-link-service-handlers';

const logger = loggerFactory('growi:features:backlinks:page-link-service');

type BacklinkSource = {
  _id: Types.ObjectId;
  path: string;
};
export class PageLinkService {
  constructor(private crowi: Crowi) {}
  static create(crowi: Crowi): PageLinkService {
    const pageLinkService = new PageLinkService(crowi);
    pageLinkService.registerEvents();
    return pageLinkService;
  }

  private registerEvents(): void {
    const pageEvent = this.crowi.events.page;
    pageEvent.on('create', (page: PageDocument) => this.onUpsert(page));
    pageEvent.on('update', (page: PageDocument) => this.onUpsert(page));
  }

  private async onUpsert(page: PageDocument): Promise<void> {
    try {
      const siteUrl = this.crowi.configManager.getConfig('app:siteUrl');

      await handlePageUpsert(page, siteUrl);
    } catch (err) {
      logger.error({ err, pageId: page._id }, 'backlinks sync failed');
    }
  }

  async findBacklinks(
    toPageId: Types.ObjectId,
    user: IUser | null,
  ): Promise<IBacklink[]> {
    const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
      'Page',
    );
    const backlinkIds = await PageLink.findBacklinkSources(toPageId);

    const builder = new PageQueryBuilder(
      Page.find({ _id: { $in: backlinkIds } }),
    );

    await builder.addViewerCondition(user);
    builder.addConditionToExcludeTrashed();

    const pages: BacklinkSource[] = await builder.query
      .select('_id path')
      .lean()
      .exec();

    const backlinks: IBacklink[] = pages.map((page) => ({
      pageId: page._id.toString(),
      path: page.path,
    }));

    return backlinks;
  }
}
