import { configManager } from '~/server/service/config-manager';
import CronService from '~/server/service/cron';
import loggerFactory from '~/utils/logger';

import { refreshModelCatalog } from './ai-sdk-modules/refresh-model-catalog';

const logger = loggerFactory(
  'growi:features:mastra:services:model-catalog-refresh-jobs',
);

/**
 * Periodic model-catalog refresh (Req 9.3). Instantiated and started ONLY when
 * the opt-in schedule config is set (see startModelCatalogRefreshCronIfEnabled)
 * — the default configuration never communicates externally (Req 9.6).
 */
class ModelCatalogRefreshCronService extends CronService {
  override getCronSchedule(): string {
    return configManager.getConfig('ai:modelCatalogRefreshCronSchedule') ?? '';
  }

  override async executeJob(): Promise<void> {
    // refreshModelCatalog throws on failure WITHOUT persisting, so a failed
    // tick keeps the last-good catalog (Req 9.4); the CronService base wraps
    // executeJob and logs the error, and the schedule keeps running.
    await refreshModelCatalog();
  }
}

/**
 * Start the periodic refresh cron IFF `ai:modelCatalogRefreshCronSchedule` is
 * set (opt-in, Req 9.3/9.6). Called from Crowi#setupCron at boot. An invalid
 * schedule expression is logged and skipped — it must never break the boot
 * sequence (Req 9.4).
 */
export const startModelCatalogRefreshCronIfEnabled = (): void => {
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
 * Fire a one-shot catalog refresh after the server is up IFF
 * `ai:modelCatalogRefreshOnStartup` is true (opt-in, Req 9.2/9.6; intended for
 * baked-image deployments such as growi-docker-compose). Fire-and-forget: the
 * boot sequence is never blocked, and a failure only logs a warning — the
 * bundled/last-good catalog stays in effect (Req 9.4).
 */
export const triggerModelCatalogRefreshOnStartupIfEnabled = (): void => {
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
