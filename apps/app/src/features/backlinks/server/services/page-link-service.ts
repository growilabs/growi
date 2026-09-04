import type { IUser } from '@growi/core';
import type { Types } from 'mongoose';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import type { IBacklink } from '../../interfaces/backlink';
import { findBacklinks } from './find-backlinks';
import { PageLinkUpsertQueue } from './page-link-upsert-queue';
import { resolveUpsertQueuePacing } from './upsert-queue-pacing';

const logger = loggerFactory('growi:features:backlinks:page-link-service');

/**
 * Crowi-facing entry point for the backlinks index.
 *
 * Deliberately thin: it owns only the wiring that needs a Crowi instance —
 * lifecycle-event subscription and config access — and delegates the work to
 * modules that need neither. The write side is paced by `PageLinkUpsertQueue`,
 * the read side is `findBacklinks`.
 */
export class PageLinkService {
  private crowi: Crowi;
  private upsertQueue: PageLinkUpsertQueue;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    // The site URL is read per drain rather than captured now: the service is
    // constructed during boot, before admins can change it at runtime. The pacing
    // budget is env-only, so reading it once here is enough.
    this.upsertQueue = new PageLinkUpsertQueue(
      () => this.crowi.configManager.getConfig('app:siteUrl'),
      resolveUpsertQueuePacing({
        drainIntervalMs: crowi.configManager.getConfig(
          'backlinks:drainIntervalMs',
        ),
        dutyCyclePercent: crowi.configManager.getConfig(
          'backlinks:dutyCyclePercent',
        ),
      }),
    );
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
        logger.error('Page ID is undefined');
        return;
      }

      this.upsertQueue.enqueue(page._id.toString());
    } catch (err) {
      logger.error({ err, pageId: page._id }, 'backlinks sync failed');
    }
  }

  findBacklinks(
    toPageId: Types.ObjectId,
    user: IUser | null,
  ): Promise<IBacklink[]> {
    return findBacklinks(toPageId, user);
  }
}
