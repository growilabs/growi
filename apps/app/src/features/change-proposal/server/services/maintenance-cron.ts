import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import { getYjsService } from '~/server/service/yjs';
import { randomSleep } from '~/server/util/random-sleep';
import loggerFactory from '~/utils/logger';

import { createChangeProposalService } from './change-proposal-service';
import type { MaintenanceActions } from './maintenance-actions';
import { readChangeProposalSettings } from './settings';

const logger = loggerFactory(
  'growi:features:change-proposal:services:maintenance-cron',
);

// Spreads the servers sharing one schedule; correctness under overlap comes from
// the model's conditional updates, not from this. Kept well under the default interval.
const MAX_RANDOM_SLEEP_MS = 2 * 60 * 1000;

export type MaintenanceRunSummary = {
  readonly withdrawn: number;
  readonly expired: number;
  readonly resumed: number;
  readonly settled: number;
};

export type MaintenanceRunOptions = {
  readonly now: Date;
  readonly isWriteEnabled: boolean;
  readonly canResumeApplies: boolean;
};

// One failing step (e.g. a DB error while reading candidates) must not stop the others.
const runStep = async (
  step: string,
  task: () => Promise<number>,
): Promise<number> => {
  try {
    return await task();
  } catch (err) {
    logger.error({ err }, `Change proposal maintenance step '${step}' failed`);
    return 0;
  }
};

export const runChangeProposalMaintenance = async (
  actions: MaintenanceActions,
  options: MaintenanceRunOptions,
): Promise<MaintenanceRunSummary> => {
  const { now } = options;
  const withdrawn = options.isWriteEnabled
    ? 0
    : await runStep('withdraw', () => actions.withdrawAllPending());
  const expired = await runStep('expire', () =>
    actions.expireDueProposals(now),
  );
  const resumed = options.canResumeApplies
    ? await runStep('resume', () => actions.resumeInterruptedApplies(now))
    : 0;
  const settled = await runStep('settle', () =>
    actions.settleStalledProposals(),
  );
  return { withdrawn, expired, resumed, settled };
};

// The cron is scheduled during Crowi#init, but the YjsService is created later in
// Crowi#start; an apply before that would record its operations as failed: write-error.
const isYjsServiceReady = (): boolean => {
  try {
    getYjsService();
    return true;
  } catch {
    return false;
  }
};

export type ChangeProposalMaintenanceCronDeps = {
  readonly actions: MaintenanceActions;
  readonly isMaintenanceMode: () => boolean;
  readonly isYjsReady?: () => boolean;
  readonly sleep?: () => Promise<void>;
  readonly now?: () => Date;
};

export class ChangeProposalMaintenanceCronService extends CronService {
  readonly deps: ChangeProposalMaintenanceCronDeps;

  // A run that resumes many applies can outlast the interval; the next tick on this
  // server is skipped rather than stacked on top of it.
  private isRunning = false;

  constructor(deps: ChangeProposalMaintenanceCronDeps) {
    super();
    this.deps = deps;
  }

  override getCronSchedule(): string {
    // Constructed only by startChangeProposalMaintenanceCronIfEnabled after it has
    // confirmed a non-empty schedule.
    return (
      configManager.getConfig('changeProposal:maintenanceCronSchedule') ?? ''
    );
  }

  override async executeJob(): Promise<void> {
    if (this.isRunning) {
      logger.info(
        'Skipping change proposal maintenance: the previous run has not finished',
      );
      return;
    }
    this.isRunning = true;
    try {
      await this.runOnce();
    } finally {
      this.isRunning = false;
    }
  }

  private async runOnce(): Promise<void> {
    const {
      actions,
      isMaintenanceMode,
      isYjsReady = isYjsServiceReady,
      sleep = () => randomSleep(MAX_RANDOM_SLEEP_MS),
      now = () => new Date(),
    } = this.deps;

    await sleep();

    if (isMaintenanceMode()) {
      logger.info(
        'Skipping change proposal maintenance: GROWI is in maintenance mode',
      );
      return;
    }

    const canResumeApplies = isYjsReady();
    if (!canResumeApplies) {
      logger.info(
        'Not resuming change proposal applies yet: the YjsService is not initialized',
      );
    }

    const summary = await runChangeProposalMaintenance(actions, {
      now: now(),
      isWriteEnabled: readChangeProposalSettings().isEnabled,
      canResumeApplies,
    });
    logger.info(summary, 'Change proposal maintenance finished');
  }
}

/**
 * Start the maintenance cron IFF `changeProposal:maintenanceCronSchedule` is
 * non-empty. Called from Crowi#setupCron at boot, whether or not the feature is
 * enabled: a disabled feature still has pending proposals to withdraw.
 */
export const startChangeProposalMaintenanceCronIfEnabled = (
  crowi: Crowi,
): void => {
  const schedule = configManager.getConfig(
    'changeProposal:maintenanceCronSchedule',
  );
  if (schedule == null || schedule.trim() === '') {
    logger.info('Change proposal maintenance is disabled by configuration');
    return;
  }

  // An invalid expression is logged and skipped rather than allowed to break the
  // boot (same contract as startWipPageCleanupCronIfEnabled).
  try {
    new ChangeProposalMaintenanceCronService({
      actions: createChangeProposalService(crowi),
      isMaintenanceMode: () => crowi.appService.isMaintenanceMode(),
    }).startCron();
    logger.info(`Scheduled change proposal maintenance (cron: '${schedule}')`);
  } catch (err) {
    logger.error(
      `Failed to schedule change proposal maintenance (cron: '${schedule}')`,
      err,
    );
  }
};
