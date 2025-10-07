export { addApplicationMetrics } from './application-metrics';
export { addPageCountsMetrics } from './page-counts-metrics';
export { addUserCountsMetrics } from './user-counts-metrics';

export const setupCustomMetrics = async (): Promise<void> => {
  const { addApplicationMetrics } = await import('./application-metrics');
  const { addUserCountsMetrics } = await import('./user-counts-metrics');
  const { addPageCountsMetrics } = await import('./page-counts-metrics');

  // Add custom metrics
  addApplicationMetrics();
  addUserCountsMetrics();
  addPageCountsMetrics();
};
