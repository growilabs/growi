import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { handlePageUpsert } from './page-link-service-handlers';

const logger = loggerFactory('growi:features:backlinks:page-link-service');

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
}
