export { addApplicationMetrics } from './application-metrics';
export { addUserCountsMetrics } from './user-counts-metrics';

export const setupCustomMetrics = async (): Promise<void> => {
  const { addApplicationMetrics } = await import('./application-metrics');
  const { addUserCountsMetrics } = await import('./user-counts-metrics');

  // Add custom metrics
  addApplicationMetrics();
  addUserCountsMetrics();
};
