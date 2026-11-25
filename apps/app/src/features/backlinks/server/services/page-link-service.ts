import type { IUser } from '@growi/core';
import type { Types } from 'mongoose';

import type Crowi from '~/server/crowi';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageDocument } from '~/server/models/page';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { IBacklink, ILinkTarget } from '../../interfaces/backlink';
import { resolveBackfillPacing } from './backfill-pacing';
import { findBacklinks } from './find-backlinks';
import { findForwardLinkHealth } from './find-forward-link-health';
import {
  BACKFILL_POLL_CRON_SCHEDULE,
  createAdminProgressEmitter,
  PageLinkBackfillCron,
} from './page-link-backfill-cron';
import { handlePagesDelete } from './page-link-service-handlers';
import { PageLinkUpsertQueue } from './page-link-upsert-queue';
import { resolveUpsertQueuePacing } from './upsert-queue-pacing';

const logger = loggerFactory('growi:features:backlinks:page-link-service');

/**
 * Crowi-facing entry point for the backlinks index.
 *
 * Deliberately thin: it owns only the wiring that needs a Crowi instance —
 * lifecycle-event subscription, holding the backfill poll, and config access —
 * and delegates the work to modules that need none of it. The write
 * side is paced by `PageLinkUpsertQueue`, the read side is `findBacklinks`.
 */
export class PageLinkService {
  private crowi: Crowi;
  private upsertQueue: PageLinkUpsertQueue;
  /** Built on first use: at boot when a run is outstanding, else by the first admin request. */
  private backfillPollInstance: PageLinkBackfillCron | undefined;

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

  /** The backfill poll this process holds, if one was built. */
  get backfillPoll(): PageLinkBackfillCron | undefined {
    return this.backfillPollInstance;
  }

  /**
   * Boot step: create the backfill job document when it is missing, then schedule the
   * backfill poll only when a run is outstanding. Claims nothing itself, so boot never waits on
   * a run: the poll's first tick does that.
   */
  async startBackfillPoll(): Promise<void> {
    await prisma.pagelinkbackfilljobs.ensureExists();
    if (!(await prisma.pagelinkbackfilljobs.isRunOutstanding())) {
      logger.info(
        'backlinks backfill poll not scheduled: no run is outstanding',
      );
      return;
    }
    this.getOrCreateBackfillPoll().startCron();
  }

  /**
   * For the admin start and resume endpoints, after they write a request: start the poll in
   * this process if it is not running, and claim at once. The endpoint does not await it; it
   * resolves when the claim, and any run it started, has ended.
   */
  async claimBackfillNow(): Promise<void> {
    try {
      await this.getOrCreateBackfillPoll().claimNow();
    } catch (err) {
      logger.error({ err }, 'backlinks backfill claim failed');
    }
  }

  private getOrCreateBackfillPoll(): PageLinkBackfillCron {
    if (this.backfillPollInstance != null) return this.backfillPollInstance;
    const { configManager } = this.crowi;
    this.backfillPollInstance = new PageLinkBackfillCron({
      cronSchedule: BACKFILL_POLL_CRON_SCHEDULE,
      pacing: resolveBackfillPacing({
        dutyCyclePercent: configManager.getConfig(
          'backlinks:backfillDutyCyclePercent',
        ),
        maxPagesPerSecond: configManager.getConfig(
          'backlinks:backfillMaxPagesPerSecond',
        ),
        maxBodyKiB: configManager.getConfig('backlinks:backfillMaxBodyKiB'),
      }),
      // Read per run: admins can change the site URL after boot.
      getSiteUrl: () => configManager.getConfig('app:siteUrl'),
      emitProgress: createAdminProgressEmitter(this.crowi.socketIoService),
    });
    return this.backfillPollInstance;
  }

  private registerEvents(): void {
    const pageEvent = this.crowi.events.page;
    pageEvent.on('create', (page: PageDocument) => this.onUpsert(page));
    pageEvent.on('update', (page: PageDocument) => this.onUpsert(page));
    pageEvent.on('revert', (page: PageDocument) => this.onUpsert(page));
    pageEvent.on('delete', (page: PageDocument) => this.onDelete([page]));
    pageEvent.on('deleteCompletely', (page: PageDocument) =>
      this.onDelete([page]),
    );
    pageEvent.on('syncDescendantsDelete', (pages: PageDocument[]) =>
      this.onDelete(pages),
    );
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

  private onDelete(pages: PageDocument[]): void {
    const ids = pages.map((page) => page._id).filter((id) => id != null);
    this.upsertQueue.abandon(ids.map((id) => id.toString()));

    handlePagesDelete(ids);
  }

  findBacklinks(
    toPageId: Types.ObjectId,
    user: IUser | null,
    userGroups: ObjectIdLike[] | null,
  ): Promise<IBacklink[]> {
    return findBacklinks(toPageId, user, userGroups);
  }

  findForwardLinkHealth(
    fromPageId: Types.ObjectId,
    user: IUser | null,
    userGroups: ObjectIdLike[] | null,
  ): Promise<ILinkTarget[]> {
    return findForwardLinkHealth(fromPageId, user, userGroups);
  }
}
