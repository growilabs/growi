import {
  AI_DISABLED_REASON_CATALOG_STALE,
  readAiDisabledReason,
} from '~/features/ai-usage/server';
import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import { randomSleep } from '~/server/util/random-sleep';
import loggerFactory from '~/utils/logger';

import { refreshModelCatalog } from './ai-sdk-modules/refresh-model-catalog';
import { isAiEnabled } from './is-ai-enabled';

const logger = loggerFactory(
  'growi:features:mastra:services:model-catalog-refresh-jobs',
);

/**
 * The refresh runs while AI is enabled, and also while AI is disabled for the
 * stale-catalog reason (so the catalog can recover). Any other disabled state
 * must not communicate externally.
 */
export const isCatalogRefreshAllowed = (): boolean =>
  isAiEnabled() || readAiDisabledReason() === AI_DISABLED_REASON_CATALOG_STALE;

/** Upper bound of the random delay before a scheduled fetch (1 hour). */
export const MAX_SCHEDULED_REFRESH_DELAY_MS = 60 * 60 * 1000;

type JitteredRefreshScheduler = {
  readonly onTick: () => Promise<void>;
};

/**
 * Wraps a job so each tick waits a random delay before running. A tick that
 * arrives while an earlier one is still waiting cuts that wait short, so the
 * earlier run happens immediately and never slips past the next tick (Req 6.5).
 */
export const createJitteredRefreshScheduler = (params: {
  readonly maxDelayMs: number;
  readonly run: () => Promise<void>;
}): JitteredRefreshScheduler => {
  let pendingWait: AbortController | undefined;

  const onTick = async (): Promise<void> => {
    pendingWait?.abort();
    const wait = new AbortController();
    pendingWait = wait;

    await randomSleep(params.maxDelayMs, wait.signal);

    if (pendingWait === wait) {
      pendingWait = undefined;
    }
    await params.run();
  };

  return { onTick };
};

/**
 * Periodic model-catalog refresh (Req 9.3). Instantiated and started ONLY when
 * the refresh is allowed and the schedule config is non-empty (see
 * startModelCatalogRefreshCronIfEnabled).
 */
class ModelCatalogRefreshCronService extends CronService {
  override getCronSchedule(): string {
    // `?? ''` only satisfies the non-nullable return type: this service is
    // constructed solely by startModelCatalogRefreshCronIfEnabled AFTER it has
    // confirmed a non-empty schedule, so '' is never actually reached here.
    return configManager.getConfig('ai:modelCatalogRefreshCronSchedule') ?? '';
  }

  private readonly scheduler = createJitteredRefreshScheduler({
    maxDelayMs: MAX_SCHEDULED_REFRESH_DELAY_MS,
    run: () => refreshModelCatalog().then(() => undefined),
  });

  override async executeJob(): Promise<void> {
    // refreshModelCatalog throws on failure WITHOUT persisting, so a failed
    // tick keeps the last-good catalog (Req 9.4); the CronService base wraps
    // executeJob and logs the error, and the schedule keeps running.
    await this.scheduler.onTick();
  }
}

/**
 * Start the periodic refresh cron IFF the refresh is allowed
 * (isCatalogRefreshAllowed) AND `ai:modelCatalogRefreshCronSchedule` is set.
 * Called from Crowi#setupCron at boot. An invalid schedule expression is logged
 * and skipped — it must never break the boot sequence (Req 9.4).
 *
 * The schedule defaults to a daily expression; setting the env var to an empty
 * string opts out (e.g. air-gapped AI deployments).
 */
export const startModelCatalogRefreshCronIfEnabled = (): void => {
  if (!isCatalogRefreshAllowed()) {
    return;
  }

  const schedule = configManager.getConfig(
    'ai:modelCatalogRefreshCronSchedule',
  );
  if (schedule == null || schedule.trim() === '') {
    return;
  }

  try {
    new ModelCatalogRefreshCronService().startCron();
    logger.info(
      `Scheduled the periodic model-catalog refresh (cron: '${schedule}')`,
    );
  } catch (err) {
    // e.g. an invalid cron expression — refuse to crash the boot for an
    // optional freshness feature; the bundled/last-good catalog stays in effect.
    logger.error(
      `Failed to schedule the model-catalog refresh cron (cron: '${schedule}')`,
      err,
    );
  }
};

/**
 * Fire a one-shot catalog refresh after the server is up IFF the refresh is
 * allowed (isCatalogRefreshAllowed) AND `ai:modelCatalogRefreshOnStartup` is
 * true (the default). Fire-and-forget: the boot sequence is never blocked, and a failure only logs a
 * warning — the bundled/last-good catalog stays in effect (Req 9.4).
 */
export const triggerModelCatalogRefreshOnStartupIfEnabled = (): void => {
  if (!isCatalogRefreshAllowed()) {
    return;
  }

  if (configManager.getConfig('ai:modelCatalogRefreshOnStartup') !== true) {
    return;
  }

  refreshModelCatalog().catch((err) => {
    logger.warn(
      'Startup model-catalog refresh failed; the last-good catalog stays in effect.',
      err,
    );
  });
};
