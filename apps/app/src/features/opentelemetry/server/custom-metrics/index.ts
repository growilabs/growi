export { addApplicationMetrics } from '~/features/opentelemetry/server/custom-metrics/application-metrics';
export { addInstalledAtMetrics } from '~/features/opentelemetry/server/custom-metrics/installed-at-metrics';
export { addMongooseConnectionPoolMetrics } from '~/features/opentelemetry/server/custom-metrics/mongoose-connection-pool-metrics';
export { addPageCountsMetrics } from '~/features/opentelemetry/server/custom-metrics/page-counts-metrics';
export { addSystemMetrics } from '~/features/opentelemetry/server/custom-metrics/system-metrics';
export { addUserCountsMetrics } from '~/features/opentelemetry/server/custom-metrics/user-counts-metrics';
export { addYjsMetrics } from '~/features/opentelemetry/server/custom-metrics/yjs-metrics';

export const setupCustomMetrics = async (): Promise<void> => {
  const { addApplicationMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/application-metrics'
  );
  const { addInstalledAtMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/installed-at-metrics'
  );
  const { addUserCountsMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/user-counts-metrics'
  );
  const { addPageCountsMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/page-counts-metrics'
  );
  const { addSystemMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/system-metrics'
  );
  const { addYjsMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/yjs-metrics'
  );
  const { addMongooseConnectionPoolMetrics } = await import(
    '~/features/opentelemetry/server/custom-metrics/mongoose-connection-pool-metrics'
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
