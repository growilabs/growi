import escapeStringRegexp from 'escape-string-regexp';

import { isValidObjectId } from '../objectid-utils';
import { addTrailingSlash } from '../path-utils';
import { isTopPage as _isTopPage } from './is-top-page';

export const isTopPage = _isTopPage;

export * from './generate-children-regexp';

/**
 * Whether path is the top page of users
 * @param path
 */
export const isUsersTopPage = (path: string): boolean => {
  return path === '/user';
};

/**
 * Whether the path is permalink
 * @param path
 */
export const isPermalink = (path: string): boolean => {
  const pageIdStr = path.substring(1);
  return isValidObjectId(pageIdStr);
};

/**
 * Whether path is user's homepage
 * @param path
 */
export const isUsersHomepage = (path: string): boolean => {
  // https://regex101.com/r/utVQct/1
  if (path.match(/^\/user\/[^/]+$/)) {
    return true;
  }
  return false;
};

/**
 * Whether path is the protected pages for systems
 * @param path
 */
export const isUsersProtectedPages = (path: string): boolean => {
  return isUsersTopPage(path) || isUsersHomepage(path);
};

/**
 * Whether path is movable
 * @param path
 */
export const isMovablePage = (path: string): boolean => {
  return !isTopPage(path) && !isUsersProtectedPages(path);
};

/**
 * Whether path belongs to the user page
 * @param path
 */
export const isUserPage = (path: string): boolean => {
  // https://regex101.com/r/MwifLR/1
  if (path.match(/^\/user\/.*?$/)) {
    return true;
  }

  return false;
};

/**
 * Whether path is the top page of users
 * @param path
 */
export const isTrashTopPage = (path: string): boolean => {
  return path === '/trash';
};

/**
 * Whether path belongs to the trash page
 * @param path
 */
export const isTrashPage = (path: string): boolean => {
  // https://regex101.com/r/BSDdRr/1
  if (path.match(/^\/trash(\/.*)?$/)) {
    return true;
  }

  return false;
};

/**
 * Whether path belongs to the shared page
 * @param path
 */
export const isSharedPage = (path: string): boolean => {
  // https://regex101.com/r/ZjdOiB/1
  if (path.match(/^\/share(\/.*)?$/)) {
    return true;
  }

  return false;
};

const restrictedPatternsToCreate: Array<RegExp> = [
  /\^|\$|\*|\+|#|<|>|%|\?/,
  /^\/-\/.*/,
  /^\/_r\/.*/,
  /^\/_apix?(\/.*)?/,
  /^\/?https?:\/\/.+$/, // avoid miss in renaming
  /\/{2,}/, // avoid miss in renaming
  /\s+\/\s+/, // avoid miss in renaming
  /.+\/edit$/,
  /.+\.md$/,
  /^(\.\.)$/, // see: https://github.com/growilabs/growi/issues/3582
  /(\/\.\.)\/?/, // see: https://github.com/growilabs/growi/issues/3582
  /\\/, // see: https://github.com/growilabs/growi/issues/7241
  /^\/(_search|_private-legacy-pages)(\/.*|$)/,
  /^\/(installer|register|login|logout|admin|me|files|trash|paste|comments|tags|share|attachment)(\/.*|$)/,
  /^\/user(?:\/[^/]+)?$/, // https://regex101.com/r/9Eh2S1/1
  /^(\/.+){130,}$/, // avoid deep layer path. see: https://regex101.com/r/L0kzOD/1
];
export const isCreatablePage = (path: string): boolean => {
  return !restrictedPatternsToCreate.some((pattern) => path.match(pattern));
};

/**
 * return user's homepage path
 * @param user
 */
export const userHomepagePath = (
  user: { username: string } | null | undefined,
): string => {
  if (user?.username == null) {
    return '';
  }
  return `/user/${user.username}`;
};

/**
 * return user path
 * @param parentPath
 * @param childPath
 * @param newPath
 */
export const convertToNewAffiliationPath = (
  oldPath: string,
  newPath: string,
  childPath: string,
): string => {
  if (newPath == null) {
    throw new Error('Please input the new page path');
  }
  const pathRegExp = new RegExp(`^${escapeStringRegexp(oldPath)}`, 'i');
  return childPath.replace(pathRegExp, newPath);
};

/**
 * Encode SPACE and IDEOGRAPHIC SPACE
 * @param {string} path
 * @returns {string}
 */
export const encodeSpaces = (path?: string): string | undefined => {
  if (path == null) {
    return undefined;
  }

  // Encode SPACE and IDEOGRAPHIC SPACE
  return path.replace(/ /g, '%20').replace(/\u3000/g, '%E3%80%80');
};

/**
 * Generate editor path
 * @param {string} paths
 * @returns {string}
 */
export const generateEditorPath = (...paths: string[]): string => {
  const joinedPath = [...paths].join('/');

  if (!isCreatablePage(joinedPath)) {
    throw new Error('Invalid characters on path');
  }

  try {
    const url = new URL(joinedPath, 'https://dummy');
    return `${url.pathname}#edit`;
  } catch {
    throw new Error('Invalid path format');
  }
};

/**
 * return paths without duplicate area of regexp /^${path}\/.+/i
 * ex. expect(omitDuplicateAreaPathFromPaths(['/A', '/A/B', '/A/B/C'])).toStrictEqual(['/A'])
 * @param paths paths to be tested
 * @returns omitted paths
 */
export const omitDuplicateAreaPathFromPaths = (paths: string[]): string[] => {
  const uniquePaths = Array.from(new Set(paths));
  return uniquePaths.filter((path) => {
    const isDuplicate =
      uniquePaths.filter((p) => new RegExp(`^${p}\\/.+`, 'i').test(path))
        .length > 0;

    return !isDuplicate;
  });
};

/**
 * return pages with path without duplicate area of regexp /^${path}\/.+/i
 * if the pages' path are the same, it will NOT omit any of them since the other attributes will not be the same
 * @param paths paths to be tested
 * @returns omitted paths
 */
// biome-ignore lint/suspicious/noExplicitAny: ignore
export const omitDuplicateAreaPageFromPages = (pages: any[]): any[] => {
  return pages.filter((page) => {
    const isDuplicate = pages.some((p) =>
      new RegExp(`^${p.path}\\/.+`, 'i').test(page.path),
    );

    return !isDuplicate;
  });
};

/**
 * Check if the area of either path1 or path2 includes the area of the other path
 * The area of path is the same as /^\/hoge\//i
 * @param pathToTest string
 * @param pathToBeTested string
 * @returns boolean
 */
export const isEitherOfPathAreaOverlap = (
  path1: string,
  path2: string,
): boolean => {
  if (path1 === path2) {
    return true;
  }

  const path1WithSlash = addTrailingSlash(path1);
  const path2WithSlash = addTrailingSlash(path2);

  const path1Area = new RegExp(`^${escapeStringRegexp(path1WithSlash)}`, 'i');
  const path2Area = new RegExp(`^${escapeStringRegexp(path2WithSlash)}`, 'i');

  if (path1Area.test(path2) || path2Area.test(path1)) {
    return true;
  }

  return false;
};

/**
 * Check if the area of pathToTest includes the area of pathToBeTested
 * The area of path is the same as /^\/hoge\//i
 * @param pathToTest string
 * @param pathToBeTested string
 * @returns boolean
 */
export const isPathAreaOverlap = (
  pathToTest: string,
  pathToBeTested: string,
): boolean => {
  if (pathToTest === pathToBeTested) {
    return true;
  }

  const pathWithSlash = addTrailingSlash(pathToTest);

  const pathAreaToTest = new RegExp(
    `^${escapeStringRegexp(pathWithSlash)}`,
    'i',
  );
  if (pathAreaToTest.test(pathToBeTested)) {
    return true;
  }

  return false;
};

/**
 * Determine whether can move by fromPath and toPath
 * @param fromPath string
 * @param toPath string
 * @returns boolean
 */
export const canMoveByPath = (fromPath: string, toPath: string): boolean => {
  return !isPathAreaOverlap(fromPath, toPath);
};

/**
 * check if string has '/' in it
 */
export const hasSlash = (str: string): boolean => {
  return str.includes('/');
};

/**
 * Get username from user page path
 * @param path string
 * @returns string | null
 */
export const getUsernameByPath = (path: string): string | null => {
  let username: string | null = null;
  // https://regex101.com/r/qj4SfD/1
  const match = path.match(/^\/user\/([^/]+)\/?/);
  if (match) {
    username = match[1];
  }

  return username;
};

export const isGlobPatternPath = (path: string): boolean => {
  // https://regex101.com/r/IBy7HS/1
  const globPattern = /^(?:\/[^/*?[\]{}]+)*\/\*$/;
  return globPattern.test(path);
};

export * from './is-top-page';
