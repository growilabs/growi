export { addAiSummarizeMetrics } from './ai-summarize-metrics';
export { addApplicationMetrics } from './application-metrics';
export { addInstalledAtMetrics } from './installed-at-metrics';
export { addMongooseConnectionPoolMetrics } from './mongoose-connection-pool-metrics';
export { addPageCountsMetrics } from './page-counts-metrics';
export { addSystemMetrics } from './system-metrics';
export { addUserCountsMetrics } from './user-counts-metrics';
export { addYjsMetrics } from './yjs-metrics';

export const setupCustomMetrics = async (): Promise<void> => {
  const { addAiSummarizeMetrics } = await import('./ai-summarize-metrics');
  const { addApplicationMetrics } = await import('./application-metrics');
  const { addInstalledAtMetrics } = await import('./installed-at-metrics');
  const { addUserCountsMetrics } = await import('./user-counts-metrics');
  const { addPageCountsMetrics } = await import('./page-counts-metrics');
  const { addSystemMetrics } = await import('./system-metrics');
  const { addYjsMetrics } = await import('./yjs-metrics');
  const { addMongooseConnectionPoolMetrics } = await import(
    './mongoose-connection-pool-metrics'
  );

  // Add custom metrics
  addAiSummarizeMetrics();
  addApplicationMetrics();
  addInstalledAtMetrics();
  addUserCountsMetrics();
  addPageCountsMetrics();
  addSystemMetrics();
  addYjsMetrics();
  addMongooseConnectionPoolMetrics();
};
