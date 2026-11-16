// What actually turns `OutboxDispatcher` into something that happens.
//
// design.md: GROWI already has three collections-with-a-`state`-column that
// are worked through periodically (`page-bulk-export`,
// `audit-log-bulk-export`, `growi-vault`), all of them subclasses of
// `server/service/cron.ts`'s `CronService`, all of them started from the one
// place every cron in this repository is started (`crowi/index.ts`'s
// `setupCron`). A fourth mechanism is not needed and would only be a second
// place to look, so this is a `CronService` too, running every 5 minutes: a
// written row is sent right away (`requestDrain`), so the cron only picks up
// retries and sends that stopped mid-way (Requirement 2.11).
//
// The cron gives no exclusion of its own -- every instance ticks -- which is
// exactly why the drain takes a row at a time with a conditional update. See
// `outbox-dispatcher.ts`. A tick that finds no chat integration at all
// does nothing, so a GROWI that never used one pays no per-tick queries.

import CronService from '~/server/service/cron';

import type { IntegrationPresence } from '../integration-presence';
import { integrationPresence } from '../integration-presence';
import { outboxDispatcher } from './deliverers';
import type { OutboxDispatcher } from './outbox-dispatcher';

export interface OutboxDispatchCronDeps {
  readonly dispatcher?: OutboxDispatcher;
  readonly presence?: IntegrationPresence;
  /** Test seam; production uses `() => new Date()`. */
  readonly clock?: () => Date;
}

export class OutboxDispatchCronService extends CronService {
  private readonly dispatcher: OutboxDispatcher;
  private readonly presence: IntegrationPresence;
  private readonly clock: () => Date;

  constructor(deps: OutboxDispatchCronDeps = {}) {
    super();
    this.dispatcher = deps.dispatcher ?? outboxDispatcher;
    this.presence = deps.presence ?? integrationPresence;
    this.clock = deps.clock ?? (() => new Date());
  }

  override getCronSchedule(): string {
    return '*/5 * * * *';
  }

  override async executeJob(): Promise<void> {
    if (!(await this.presence.hasAnyIntegration(this.clock()))) {
      return;
    }
    await this.dispatcher.requestDrain();
  }
}

export const outboxDispatchCronService = new OutboxDispatchCronService(); // singleton instance
