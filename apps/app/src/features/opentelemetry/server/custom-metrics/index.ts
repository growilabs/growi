export { addApplicationMetrics } from './application-metrics';
export { addInstalledAtMetrics } from './installed-at-metrics';
export { addPageCountsMetrics } from './page-counts-metrics';
export { addSystemMetrics } from './system-metrics';
export { addUserCountsMetrics } from './user-counts-metrics';

export const setupCustomMetrics = async (): Promise<void> => {
  const { addApplicationMetrics } = await import('./application-metrics');
  const { addInstalledAtMetrics } = await import('./installed-at-metrics');
  const { addUserCountsMetrics } = await import('./user-counts-metrics');
  const { addPageCountsMetrics } = await import('./page-counts-metrics');
  const { addSystemMetrics } = await import('./system-metrics');

  // Add custom metrics
  addApplicationMetrics();
  addInstalledAtMetrics();
  addUserCountsMetrics();
  addPageCountsMetrics();
  addSystemMetrics();
};
