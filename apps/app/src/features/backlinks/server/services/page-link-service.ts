import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { handlePageUpsert } from './page-link-service-handlers';

const logger = loggerFactory('growi:features:backlinks:page-link-service');

export class PageLinkService {
  constructor(private crowi: Crowi) {}
  static create(crowi: Crowi) {
    const s = new PageLinkService(crowi);
    s.registerEvents();
    return s;
  }

  private registerEvents() {
    const e = this.crowi.events.page;
    e.on('create', (page: PageDocument) => this.onUpsert(page));
    e.on('update', (page: PageDocument) => this.onUpsert(page));
  }

  private async onUpsert(page: PageDocument) {
    try {
      const siteUrl = this.crowi.configManager.getConfig('app:siteUrl');

      await handlePageUpsert(page, siteUrl);
    } catch (err) {
      logger.error({ err, pageId: page._id }, 'backlinks sync failed');
    }
  }
}
