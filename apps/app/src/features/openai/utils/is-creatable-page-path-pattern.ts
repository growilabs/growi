import { pagePathUtils } from '@growi/core/dist/utils';

import { removeGlobPath } from './remove-glob-path';

export const isCreatablePagePathPattern = (pagePath: string): boolean => {
  const isGlobPattern = pagePathUtils.isGlobPatternPath(pagePath);
  if (isGlobPattern) {
    // Remove glob pattern since glob paths are non-creatable in GROWI
    const pathWithoutGlob = removeGlobPath([pagePath])[0];
    return pagePathUtils.isCreatablePage(pathWithoutGlob);
  }

  return pagePathUtils.isCreatablePage(pagePath);
};
