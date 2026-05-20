/**
 * Installed-at metrics.
 *
 * Exposes two independent metrics derived from the same data source
 * (growiInfoService.getGrowiInfo). Bundled in a single file because they share
 * the fetch — a single batch callback observes both gauges in one call,
 * avoiding duplicate DB access per collection interval.
 *
 * Prometheus exposure (OTel `.` → Prometheus `_`):
 *   growi.installed_at.timestamp.seconds              → growi_installed_at_timestamp_seconds
 *   growi.installed_at.by_oldest_user.timestamp.seconds → growi_installed_at_by_oldest_user_timestamp_seconds
 */
import { diag, metrics } from '@opentelemetry/api';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:opentelemetry:custom-metrics:installed-at-metrics',
);
const loggerDiag = diag.createComponentLogger({
  namespace: 'growi:custom-metrics:installed-at',
});

function toUnixSeconds(date: Date | null | undefined): number | undefined {
  if (date == null) return undefined;
  return Math.floor(date.getTime() / 1000);
}

export function addInstalledAtMetrics(): void {
  logger.info('Starting installed-at metrics collection');

  const meter = metrics.getMeter('growi-installed-at-metrics', '1.0.0');

  // Metric 1/2: installation time recorded at system setup
  const installedAtGauge = meter.createObservableGauge(
    'growi.installed_at.timestamp.seconds',
    {
      description: 'GROWI installation time as Unix timestamp (seconds)',
      unit: 's',
    },
  );

  // Metric 2/2: installation time inferred from the oldest user
  const installedAtByOldestUserGauge = meter.createObservableGauge(
    'growi.installed_at.by_oldest_user.timestamp.seconds',
    {
      description:
        'GROWI installation time inferred from the oldest user as Unix timestamp (seconds)',
      unit: 's',
    },
  );

  // Single batch callback feeds both gauges from one growiInfoService fetch
  meter.addBatchObservableCallback(
    async (result) => {
      try {
        // Dynamic import to avoid circular dependencies
        const { growiInfoService } = await import(
          '~/server/service/growi-info'
        );
        const growiInfo = await growiInfoService.getGrowiInfo({
          includeInstalledInfo: true,
        });

        const installedAtSeconds = toUnixSeconds(
          growiInfo.additionalInfo?.installedAt,
        );
        if (installedAtSeconds != null) {
          result.observe(installedAtGauge, installedAtSeconds);
        }

        const installedAtByOldestUserSeconds = toUnixSeconds(
          growiInfo.additionalInfo?.installedAtByOldestUser,
        );
        if (installedAtByOldestUserSeconds != null) {
          result.observe(
            installedAtByOldestUserGauge,
            installedAtByOldestUserSeconds,
          );
        }
      } catch (error) {
        loggerDiag.error('Failed to collect installed-at metrics', { error });
      }
    },
    [installedAtGauge, installedAtByOldestUserGauge],
  );

  logger.info('Installed-at metrics collection started successfully');
}
