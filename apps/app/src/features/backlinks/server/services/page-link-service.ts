import type { IUser } from '@growi/core';
import type { HydratedDocument, Types } from 'mongoose';
import mongoose from 'mongoose';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { PageQueryBuilder } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { IBacklink } from '../../interfaces/backlink';
import PageLink from '../models/page-link';
import { handlePageUpsertById } from './page-link-service-handlers';

const logger = loggerFactory('growi:features:backlinks:page-link-service');

// Read-path scale for heavily-linked hub pages (bounding/index/interactive-time) is handled in B2.1; intentionally unbounded here.
type BacklinkSource = {
  _id: Types.ObjectId;
  path: string;
};

export const DRAIN_INTERVAL_MS = 1000;
export const MAX_PAGES_PER_DRAIN = 3;

export class PageLinkService {
  private pagesToUpsert: Set<string>;
  private drainTimer: NodeJS.Timeout | null;
  private draining: boolean;
  constructor(private crowi: Crowi) {
    this.pagesToUpsert = new Set<string>();
    this.draining = false;
    this.drainTimer = null;
  }

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

  private onUpsert(page: PageDocument): void {
    try {
      if (page._id == null) {
        throw new Error('Page ID is undefined');
      }

      this.pagesToUpsert.add(page._id.toString());

      this.scheduleDrain();
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

  private scheduleDrain(): void {
    if (this.drainTimer != null || this.draining) return;
    this.drainTimer = setTimeout(() => {
      this.drain().catch((err) =>
        logger.error({ err }, 'backlinks drain failed'),
      );
    }, DRAIN_INTERVAL_MS);
    // A pending drain must not keep the process alive; dropped work self-heals on the next edit.
    this.drainTimer.unref();
  }

  private async drain(): Promise<void> {
    this.drainTimer = null;
    this.draining = true;

    try {
      const siteUrl = this.crowi.configManager.getConfig('app:siteUrl');
      const batch = [...this.pagesToUpsert].slice(0, MAX_PAGES_PER_DRAIN);

      // Remove before processing: a save landing mid-drain re-enqueues the id and gets a fresh
      // run, whereas removing afterwards would swallow that save's changes.
      for (const id of batch) {
        this.pagesToUpsert.delete(id);
      }

      for (const id of batch) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: pacing is the point — parses run one at a time so the event loop is yielded between them (req 3.5)
          await handlePageUpsertById(id, siteUrl);
        } catch (err) {
          logger.error({ err, pageId: id }, 'backlinks sync failed');
        }
      }
    } finally {
      this.draining = false;
      if (this.pagesToUpsert.size > 0) this.scheduleDrain();
    }
  }
}
