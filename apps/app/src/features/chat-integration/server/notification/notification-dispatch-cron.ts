// What actually turns `NotificationDispatcher` into something that happens.
//
// design.md: GROWI already has three collections-with-a-`state`-column that
// are worked through periodically (`page-bulk-export`,
// `audit-log-bulk-export`, `growi-vault`), all of them subclasses of
// `server/service/cron.ts`'s `CronService`, all of them started from the one
// place every cron in this repository is started (`crowi/index.ts`'s
// `setupCron`). A fourth mechanism is not needed and would only be a second
// place to look, so this is a `CronService` too, running once a minute.
//
// The cron gives no exclusion of its own -- every instance ticks -- which is
// exactly why the drain takes a row at a time with a conditional update. See
// `notification-dispatcher.ts`. A tick that finds no chat integration at all
// does nothing, so a GROWI that never used one pays no per-minute queries.

import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

import type { IntegrationPresence } from '../integration-presence';
import { integrationPresence } from '../integration-presence';
import type { NotificationDispatcher } from './notification-dispatcher';
import { notificationDispatcher } from './notification-dispatcher';

const logger = loggerFactory(
  'growi:features:chat-integration:notification-dispatch-cron',
);

export interface ChatNotificationDispatchCronDeps {
  readonly dispatcher?: NotificationDispatcher;
  readonly presence?: IntegrationPresence;
  /** Test seam; production uses `() => new Date()`. */
  readonly clock?: () => Date;
}

export class ChatNotificationDispatchCronService extends CronService {
  private readonly dispatcher: NotificationDispatcher;
  private readonly presence: IntegrationPresence;
  private readonly clock: () => Date;

  constructor(deps: ChatNotificationDispatchCronDeps = {}) {
    super();
    this.dispatcher = deps.dispatcher ?? notificationDispatcher;
    this.presence = deps.presence ?? integrationPresence;
    this.clock = deps.clock ?? (() => new Date());
  }

  override getCronSchedule(): string {
    return '* * * * *';
  }

  override async executeJob(): Promise<void> {
    const now = this.clock();

    if (!(await this.presence.hasAnyIntegration(now))) {
      return;
    }

    // `CronService` already logs a thrown job, but catching here keeps the
    // failure message specific to the outbox.
    try {
      await this.dispatcher.drain(now);
    } catch (err) {
      logger.error('Failed to drain the chat notification outbox', err);
    }
  }
}

export const chatNotificationDispatchCronService =
  new ChatNotificationDispatchCronService(); // singleton instance
