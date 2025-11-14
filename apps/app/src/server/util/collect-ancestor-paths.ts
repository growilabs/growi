import { dirname } from 'node:path';
import { isTopPage } from '@growi/core/dist/utils/page-path-utils';

/**
 * returns ancestors paths
 * @param {string} path
 * @param {string[]} ancestorPaths
 * @returns {string[]}
 */
export const collectAncestorPaths = (
  path: string,
  ancestorPaths: string[] = [],
): string[] => {
  if (isTopPage(path)) return ancestorPaths;

  const parentPath = dirname(path);
  ancestorPaths.push(parentPath);
  return collectAncestorPaths(parentPath, ancestorPaths);
};
