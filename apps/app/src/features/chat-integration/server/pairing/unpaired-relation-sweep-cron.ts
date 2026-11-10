// Retires unpaired relations past their retention once a day.
//
// Every instance runs this; the sweep removes one relation at a time under a
// conditional delete, so concurrent runs converge on the same end state (see
// `sweep-unpaired-relations.ts`).

import CronService from '~/server/service/cron';
import { randomSleep } from '~/server/util/random-sleep';
import loggerFactory from '~/utils/logger';

import type { IntegrationPresence } from '../integration-presence';
import { integrationPresence } from '../integration-presence';
import { sweepUnpairedRelations } from './sweep-unpaired-relations';

const logger = loggerFactory(
  'growi:features:chat-integration:unpaired-relation-sweep-cron',
);

// Off the 3:00 WIP page cleanup and the 4:00 AI model list refresh.
export const UNPAIRED_RELATION_SWEEP_CRON_SCHEDULE = '0 2 * * *';

/** Upper bound of the random wait that spreads instances sharing a database. */
export const SWEEP_MAX_JITTER_MS = 60 * 60 * 1000;

export interface UnpairedRelationSweepCronDeps {
  readonly sweep?: typeof sweepUnpairedRelations;
  readonly presence?: IntegrationPresence;
  /** Test seam; production uses `() => new Date()`. */
  readonly clock?: () => Date;
  /** Test seam; production uses `randomSleep`. Receives the upper bound. */
  readonly sleep?: (maxMs: number) => Promise<void>;
}

export class UnpairedRelationSweepCronService extends CronService {
  private readonly sweep: typeof sweepUnpairedRelations;
  private readonly presence: IntegrationPresence;
  private readonly clock: () => Date;
  private readonly sleep: (maxMs: number) => Promise<void>;

  constructor(deps: UnpairedRelationSweepCronDeps = {}) {
    super();
    this.sweep = deps.sweep ?? sweepUnpairedRelations;
    this.presence = deps.presence ?? integrationPresence;
    this.clock = deps.clock ?? (() => new Date());
    this.sleep = deps.sleep ?? ((maxMs) => randomSleep(maxMs));
  }

  override getCronSchedule(): string {
    return UNPAIRED_RELATION_SWEEP_CRON_SCHEDULE;
  }

  override async executeJob(): Promise<void> {
    await this.sleep(SWEEP_MAX_JITTER_MS);

    // Decided after the wait: the answer may have changed while sleeping.
    const now = this.clock();
    if (!(await this.presence.hasAnyIntegration(now))) {
      return;
    }

    try {
      await this.sweep(now);
    } catch (err) {
      logger.error('Failed to sweep expired chat relations', err);
    }
  }
}

export const unpairedRelationSweepCronService =
  new UnpairedRelationSweepCronService(); // singleton instance
