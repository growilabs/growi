import nodePath from 'node:path';
import { pathUtils } from '@growi/core/dist/utils';

/*
 * e.g. "/a/b/c" => ["/a/b/c", "/a/b", "/a", "/"]
 */
const generatePathsOnTree = (path: string, pathList: string[]): string[] => {
  pathList.push(path);

  if (path === '/') {
    return pathList;
  }

  const newPath = nodePath.posix.dirname(path);

  return generatePathsOnTree(newPath, pathList);
};

/**
 * Expand a page path into the list of trigger-path candidates a
 * path-scoped notification setting might match against, most-specific
 * first: e.g. "/a/b/c" => ["/a/b/c", "/a/b/*", "/a/*", "/*"].
 *
 * Extracted from `GlobalNotificationSetting`'s originally-private helper of
 * the same name (see chat-integration-app design.md "パス条件の突き合わせを
 * 二重に書かない") so Gen 2's path-scoped destinations (`ChatNotificationDestination`)
 * can match against the identical rule instead of duplicating it. This move
 * does not change behavior -- `GlobalNotificationSetting`'s own matching is
 * unaffected; it now imports this function instead of defining it locally.
 */
export const generatePathsToMatch = (originalPath: string): string[] => {
  const pathList = generatePathsOnTree(originalPath, []);
  return pathList.map((path) => {
    // except for the original trigger path ("/a/b/c"), append "*" to find all matches
    // e.g. ["/a/b/c", "/a/b", "/a", "/"] => ["/a/b/c", "/a/b/*", "/a/*", "/*"]
    if (path !== originalPath) {
      return `${pathUtils.addTrailingSlash(path)}*`;
    }

    return path;
  });
};
