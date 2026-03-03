import { DevidedPagePath } from '@growi/core/dist/models';
import { pagePathUtils, pathUtils } from '@growi/core/dist/utils';

const { isTrashPage } = pagePathUtils;

/**
 * Linked Array Structured PagePath Model
 */
export default class LinkedPagePath {
  constructor(path) {
    const pagePath = new DevidedPagePath(path);

    this.path = path;
    this.pathName = pagePath.latter;
    this.isRoot = pagePath.isRoot;
    this.parent = pagePath.isRoot
      ? null
      : new LinkedPagePath(pagePath.former, true);
  }

  get href() {
    if (this.isRoot) {
      return '';
    }

    return pathUtils.normalizePath(`${this.parent.href}/${this.pathName}`);
  }

  get isInTrash() {
    return isTrashPage(this.path);
  }
}
