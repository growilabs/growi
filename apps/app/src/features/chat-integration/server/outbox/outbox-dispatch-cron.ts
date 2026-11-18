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
// The same tick also sweeps `agent` requests whose run stopped
// (design.md 定期処理).

import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

import {
  type StaleAgentRequestSweep,
  sweepStaleAgentRequests,
} from '../agent/sweep-stale-agent-requests';
import type { IntegrationPresence } from '../integration-presence';
import { integrationPresence } from '../integration-presence';
import { outboxDispatcher } from './deliverers';
import type { OutboxDispatcher } from './outbox-dispatcher';

const logger = loggerFactory(
  'growi:features:chat-integration:outbox-dispatch-cron',
);

const runIsolated = async (
  step: string,
  run: () => Promise<void>,
): Promise<void> => {
  try {
    await run();
  } catch (error) {
    logger.error(
      { step, errorName: error instanceof Error ? error.name : typeof error },
      'A step of the outbox cron tick failed',
    );
  }
};

export interface OutboxDispatchCronDeps {
  readonly dispatcher?: OutboxDispatcher;
  readonly presence?: IntegrationPresence;
  readonly sweep?: StaleAgentRequestSweep;
  /** Test seam; production uses `() => new Date()`. */
  readonly clock?: () => Date;
}

export class OutboxDispatchCronService extends CronService {
  private readonly dispatcher: OutboxDispatcher;
  private readonly presence: IntegrationPresence;
  private readonly sweep: StaleAgentRequestSweep;
  private readonly clock: () => Date;

  constructor(deps: OutboxDispatchCronDeps = {}) {
    super();
    this.dispatcher = deps.dispatcher ?? outboxDispatcher;
    this.presence = deps.presence ?? integrationPresence;
    this.sweep = deps.sweep ?? sweepStaleAgentRequests;
    this.clock = deps.clock ?? (() => new Date());
  }

  override getCronSchedule(): string {
    return '*/5 * * * *';
  }

  /**
   * Sweeps before draining, so the answers the sweep stores are already
   * written when this tick's drain runs. Each step is isolated: a failure in
   * one never stops the other.
   */
  override async executeJob(): Promise<void> {
    const now = this.clock();
    if (!(await this.presence.hasAnyIntegration(now))) {
      return;
    }
    await runIsolated('sweep stale agent requests', () => this.sweep(now));
    await runIsolated('request a drain', () => this.dispatcher.requestDrain());
  }
}

export const outboxDispatchCronService = new OutboxDispatchCronService(); // singleton instance
