import type AppService from '~/server/service/app';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import { randomSleep } from '~/server/util/random-sleep';
import loggerFactory from '~/utils/logger';

import {
  type StalledDuplicatePageOperation,
  takeOverStalledDuplicate,
} from './duplicate-page-operation';
import type { DuplicateDeps } from './duplicate-page-port';
import {
  recoverInterruptedDuplicate,
  toInterruptedDuplicate,
} from './recover-interrupted-duplicate';

const logger = loggerFactory(
  'growi:services:page:duplicate:interrupted-duplicate-recovery-cron',
);

/** Upper bound of the random wait at the start of each run. */
export const RECOVERY_JITTER_MS = 30 * 1000;

export interface InterruptedDuplicateRecoveryCronInput {
  readonly duplicateDeps: DuplicateDeps;
  readonly appService: Pick<AppService, 'isMaintenanceMode'>;
  /** Defaults to a random wait of up to RECOVERY_JITTER_MS. */
  readonly waitBeforeRun?: () => Promise<void>;
}

/**
 * Takes over and recovers duplicates whose PageOperation stopped reporting
 * progress (see design.md InterruptedDuplicateRecoveryCron). There is no
 * "already running" flag: each take-over is a conditional write, so runs that
 * overlap — including one stuck in a hung recovery — never recover the same
 * PageOperation twice.
 */
export class InterruptedDuplicateRecoveryCronService extends CronService {
  readonly duplicateDeps: DuplicateDeps;

  readonly appService: Pick<AppService, 'isMaintenanceMode'>;

  readonly waitBeforeRun: () => Promise<void>;

  constructor(input: InterruptedDuplicateRecoveryCronInput) {
    super();
    this.duplicateDeps = input.duplicateDeps;
    this.appService = input.appService;
    this.waitBeforeRun =
      input.waitBeforeRun ?? (() => randomSleep(RECOVERY_JITTER_MS));
  }

  override getCronSchedule(): string {
    // `?? ''` only satisfies the return type: the start function constructs this
    // service after confirming a non-empty schedule.
    return (
      configManager.getConfig('app:interruptedDuplicateRecoveryCronSchedule') ??
      ''
    );
  }

  override async executeJob(): Promise<void> {
    await this.waitBeforeRun();

    if (this.appService.isMaintenanceMode()) {
      logger.info(
        'Skipping the interrupted duplicate recovery: GROWI is in maintenance mode',
      );
      return;
    }

    // Sequential on purpose: one take-over, then its recovery, until none is left.
    // The loop ends because a taken-over PageOperation carries a fresh
    // lastProgressAt and cannot be taken over again for STALL_THRESHOLD_MS,
    // even when its recovery failed.
    for (;;) {
      let stalled: StalledDuplicatePageOperation | null;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: take over one at a time
        stalled = await takeOverStalledDuplicate(new Date());
      } catch (err) {
        // e.g. the DB is unreachable; retrying here would never end, so leave
        // the rest to the next run.
        logger.error(
          err,
          'Failed to take over a stalled duplicate; ending this run',
        );
        return;
      }
      if (stalled == null) {
        return;
      }

      const target = toInterruptedDuplicate(stalled);
      try {
        await recoverInterruptedDuplicate(this.duplicateDeps, target);
      } catch (err) {
        // The PageOperation is kept if the failure came before its deletion,
        // and is taken over again once it expires.
        logger.error(
          {
            err,
            operationId: target.operation.operationId,
            fromPath: target.fromPath,
            toPath: target.toPath,
          },
          'Failed to recover an interrupted duplicate',
        );
      }
    }
  }
}

/**
 * Starts the recovery cron IFF `app:interruptedDuplicateRecoveryCronSchedule`
 * is non-empty. An invalid expression is logged and skipped rather than allowed
 * to break the boot, as for startWipPageCleanupCronIfEnabled (whose comment
 * describes the node-cron behavior this catch relies on).
 */
export const startInterruptedDuplicateRecoveryCronIfEnabled = (
  input: InterruptedDuplicateRecoveryCronInput,
): void => {
  const schedule = configManager.getConfig(
    'app:interruptedDuplicateRecoveryCronSchedule',
  );
  if (schedule == null || schedule.trim() === '') {
    logger.info('Interrupted duplicate recovery is disabled by configuration');
    return;
  }

  try {
    new InterruptedDuplicateRecoveryCronService(input).startCron();
    logger.info(
      `Scheduled the interrupted duplicate recovery (cron: '${schedule}')`,
    );
  } catch (err) {
    logger.error(
      `Failed to schedule the interrupted duplicate recovery (cron: '${schedule}')`,
      err,
    );
  }
};
