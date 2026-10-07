import { diag, metrics } from '@opentelemetry/api';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:opentelemetry:custom-metrics:user-counts');
const loggerDiag = diag.createComponentLogger({
  namespace: 'growi:custom-metrics:user-counts',
});

export function addUserCountsMetrics(): void {
  logger.info('Starting user counts metrics collection');

  const meter = metrics.getMeter('growi-user-counts-metrics', '1.0.0');

  // Total user count gauge
  const userCountGauge = meter.createObservableGauge('growi.users.total', {
    description: 'Total number of users in GROWI',
    unit: 'users',
  });

  // Active user count gauge
  const activeUserCountGauge = meter.createObservableGauge(
    'growi.users.active',
    {
      description: 'Number of active users in GROWI',
      unit: 'users',
    },
  );

  // User metrics collection callback
  meter.addBatchObservableCallback(
    async (result) => {
      try {
        // Dynamic import to avoid circular dependencies
        const { growiInfoService } = await import(
          '~/server/service/growi-info'
        );

        const growiInfo = await growiInfoService.getGrowiInfo({
          includeUserCountInfo: true,
        });

        // Observe user count metrics
        result.observe(
          userCountGauge,
          growiInfo.additionalInfo?.currentUsersCount || 0,
        );
        result.observe(
          activeUserCountGauge,
          growiInfo.additionalInfo?.currentActiveUsersCount || 0,
        );
      } catch (error) {
        loggerDiag.error('Failed to collect user counts metrics', { error });
      }
    },
    [userCountGauge, activeUserCountGauge],
  );

  logger.info('User counts metrics collection started successfully');
}
