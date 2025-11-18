import { pathUtils } from '@growi/core/dist/utils';

/**
 * @example
 * // Input: '/Sandbox/Bootstrap5/'
 * // Output: ['/Sandbox/*', '/Sandbox/Bootstrap5/*']
 *
 * // Input: '/user/admin/memo/'
 * // Output: ['/user/*', '/user/admin/*', '/user/admin/memo/*']
 */
export const generateGlobPatterns = (path: string): string[] => {
  // Remove trailing slash if exists
  const normalizedPath = pathUtils.removeTrailingSlash(path);

  // Split path into segments
  const segments = normalizedPath.split('/').filter(Boolean);

  // Generate patterns
  const patterns: string[] = [];
  let currentPath = '';

  for (let i = 0; i < segments.length; i++) {
    currentPath += `/${segments[i]}`;
    patterns.push(`${currentPath}/*`);
  }

  return patterns;
};
