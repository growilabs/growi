import { diag, metrics } from '@opentelemetry/api';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:opentelemetry:custom-metrics:page-counts');
const loggerDiag = diag.createComponentLogger({
  namespace: 'growi:custom-metrics:page-counts',
});

export function addPageCountsMetrics(): void {
  logger.info('Starting page counts metrics collection');

  const meter = metrics.getMeter('growi-page-counts-metrics', '1.0.0');

  const pageCountGauge = meter.createObservableGauge('growi.pages.total', {
    description: 'Total number of pages in GROWI',
    unit: 'pages',
  });

  meter.addBatchObservableCallback(
    async (result) => {
      try {
        const { growiInfoService } = await import(
          '~/server/service/growi-info'
        );

        const growiInfo = await growiInfoService.getGrowiInfo({
          includePageCountInfo: true,
        });

        result.observe(
          pageCountGauge,
          growiInfo.additionalInfo?.currentPagesCount || 0,
        );
      } catch (error) {
        loggerDiag.error('Failed to collect page counts metrics', { error });
      }
    },
    [pageCountGauge],
  );
  logger.info('Page counts metrics collection started successfully');
}
