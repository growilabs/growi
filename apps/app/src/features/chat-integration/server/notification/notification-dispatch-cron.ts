// What actually turns `NotificationDispatcher` (and the 90-day sweep that
// rides along with it) into something that happens.
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
// exactly why both halves of the job take a row at a time with a conditional
// update. See `notification-dispatcher.ts` and `sweep-unpaired-relations.ts`.

import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

import { sweepUnpairedRelations } from '../pairing/sweep-unpaired-relations';
import type { NotificationDispatcher } from './notification-dispatcher';
import { notificationDispatcher } from './notification-dispatcher';

const logger = loggerFactory(
  'growi:features:chat-integration:notification-dispatch-cron',
);

export interface ChatNotificationDispatchCronDeps {
  readonly dispatcher?: NotificationDispatcher;
  readonly sweep?: typeof sweepUnpairedRelations;
}

export class ChatNotificationDispatchCronService extends CronService {
  private readonly dispatcher: NotificationDispatcher;
  private readonly sweep: typeof sweepUnpairedRelations;

  constructor(deps: ChatNotificationDispatchCronDeps = {}) {
    super();
    this.dispatcher = deps.dispatcher ?? notificationDispatcher;
    this.sweep = deps.sweep ?? sweepUnpairedRelations;
  }

  override getCronSchedule(): string {
    return '* * * * *';
  }

  override async executeJob(): Promise<void> {
    // One instant for both halves, so a row's backoff and a relation's
    // retention are measured against the same "now".
    const now = new Date();

    // Each half is guarded separately: `CronService` already logs a thrown
    // job, but a single catch-all would let a failing delivery attempt keep
    // the sweep from ever running (and the reverse).
    try {
      await this.dispatcher.drain(now);
    } catch (err) {
      logger.error('Failed to drain the chat notification outbox', err);
    }

    try {
      await this.sweep(now);
    } catch (err) {
      logger.error('Failed to sweep expired chat relations', err);
    }
  }
}

export const chatNotificationDispatchCronService =
  new ChatNotificationDispatchCronService(); // singleton instance
