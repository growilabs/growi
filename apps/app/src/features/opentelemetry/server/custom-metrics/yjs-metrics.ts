import { diag, metrics } from '@opentelemetry/api';
import { docs } from 'y-websocket/bin/utils';

import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:opentelemetry:custom-metrics:yjs');
const loggerDiag = diag.createComponentLogger({
  namespace: 'growi:custom-metrics:yjs',
});

/**
 * Returns the number of documents in the given map.
 * Returns 0 when the map is undefined or null (y-websocket not yet initialised).
 */
export function getDocsCount(
  d: ReadonlyMap<string, unknown> | undefined | null,
): number {
  return d?.size ?? 0;
}

export function addYjsMetrics(): void {
  logger.info('Starting yjs metrics collection');

  const meter = metrics.getMeter('growi-yjs-metrics', '1.0.0');

  const yjsDocsCountGauge = meter.createObservableGauge(
    'growi.yjs.docs.count',
    {
      description:
        'Current number of collaborative documents held by y-websocket',
      unit: '{document}',
    },
  );

  meter.addBatchObservableCallback(
    (result) => {
      try {
        result.observe(yjsDocsCountGauge, getDocsCount(docs));
      } catch (error) {
        loggerDiag.error('Failed to collect yjs metrics', { error });
      }
    },
    [yjsDocsCountGauge],
  );

  logger.info('Yjs metrics collection started successfully');
}
