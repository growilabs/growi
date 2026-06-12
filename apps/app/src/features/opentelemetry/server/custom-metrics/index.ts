export { addApplicationMetrics } from './application-metrics.js';
export { addInstalledAtMetrics } from './installed-at-metrics.js';
export { addMongooseConnectionPoolMetrics } from './mongoose-connection-pool-metrics.js';
export { addPageCountsMetrics } from './page-counts-metrics.js';
export { addSystemMetrics } from './system-metrics.js';
export { addUserCountsMetrics } from './user-counts-metrics.js';
export { addYjsMetrics } from './yjs-metrics.js';

export const setupCustomMetrics = async (): Promise<void> => {
  const { addApplicationMetrics } = await import('./application-metrics.js');
  const { addInstalledAtMetrics } = await import('./installed-at-metrics.js');
  const { addUserCountsMetrics } = await import('./user-counts-metrics.js');
  const { addPageCountsMetrics } = await import('./page-counts-metrics.js');
  const { addSystemMetrics } = await import('./system-metrics.js');
  const { addYjsMetrics } = await import('./yjs-metrics.js');
  const { addMongooseConnectionPoolMetrics } = await import(
    './mongoose-connection-pool-metrics.js'
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
