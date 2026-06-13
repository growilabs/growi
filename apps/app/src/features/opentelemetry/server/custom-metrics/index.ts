export { addApplicationMetrics } from '~/features/opentelemetry/server/custom-metrics/application-metrics.js';
export { addInstalledAtMetrics } from '~/features/opentelemetry/server/custom-metrics/installed-at-metrics.js';
export { addMongooseConnectionPoolMetrics } from '~/features/opentelemetry/server/custom-metrics/mongoose-connection-pool-metrics.js';
export { addPageCountsMetrics } from '~/features/opentelemetry/server/custom-metrics/page-counts-metrics.js';
export { addSystemMetrics } from '~/features/opentelemetry/server/custom-metrics/system-metrics.js';
export { addUserCountsMetrics } from '~/features/opentelemetry/server/custom-metrics/user-counts-metrics.js';
export { addYjsMetrics } from '~/features/opentelemetry/server/custom-metrics/yjs-metrics.js';

export const setupCustomMetrics = async (): Promise<void> => {
  const { addApplicationMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/application-metrics.js'
  );
  const { addInstalledAtMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/installed-at-metrics.js'
  );
  const { addUserCountsMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/user-counts-metrics.js'
  );
  const { addPageCountsMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/page-counts-metrics.js'
  );
  const { addSystemMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/system-metrics.js'
  );
  const { addYjsMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/yjs-metrics.js'
  );
  const { addMongooseConnectionPoolMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/mongoose-connection-pool-metrics.js'
  );

  // Add custom metrics
  addApplicationMetrics();
  addInstalledAtMetrics();
  addUserCountsMetrics();
  addPageCountsMetrics();
  addSystemMetrics();
  addYjsMetrics();
  addMongooseConnectionPoolMetrics();
};
