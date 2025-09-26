import crypto from 'node:crypto';
import { diag, metrics } from '@opentelemetry/api';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:opentelemetry:custom-metrics:application-metrics',
);
const loggerDiag = diag.createComponentLogger({
  namespace: 'growi:custom-metrics:application',
});

function getSiteUrlHashed(siteUrl: string): string {
  const hasher = crypto.createHash('sha256');
  hasher.update(siteUrl);
  return hasher.digest('hex');
}

export function addApplicationMetrics(): void {
  logger.info('Starting application config metrics collection');

  const meter = metrics.getMeter('growi-application-metrics', '1.0.0');

  // Config metrics: GROWI instance information (Prometheus info pattern)
  const growiInfoGauge = meter.createObservableGauge('growi.configs', {
    description: 'GROWI instance information (always 1)',
    unit: '1',
  });

  // Config metrics collection callback
  meter.addBatchObservableCallback(
    async (result) => {
      try {
        // Dynamic import to avoid circular dependencies
        const { growiInfoService } = await import(
          '~/server/service/growi-info'
        );
        const growiInfo = await growiInfoService.getGrowiInfo({
          includeAttachmentInfo: true,
        });

        const isAppSiteUrlHashed = configManager.getConfig(
          'otel:isAppSiteUrlHashed',
        );

        // Config metrics always have value 1, with information stored in labels
        result.observe(growiInfoGauge, 1, {
          // Dynamic information that can change through configuration
          site_url: isAppSiteUrlHashed ? '[hashed]' : growiInfo.appSiteUrl,
          site_url_hashed: isAppSiteUrlHashed
            ? getSiteUrlHashed(growiInfo.appSiteUrl)
            : undefined,
          wiki_type: growiInfo.wikiType,
          external_auth_types:
            growiInfo.additionalInfo?.activeExternalAccountTypes?.join(',') ||
            '',
        });
      } catch (error) {
        loggerDiag.error('Failed to collect application config metrics', {
          error,
        });
      }
    },
    [growiInfoGauge],
  );

  logger.info('Application config metrics collection started successfully');
}
