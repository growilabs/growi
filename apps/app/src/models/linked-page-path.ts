import { DevidedPagePath } from '@growi/core/dist/models';
import { pagePathUtils, pathUtils } from '@growi/core/dist/utils';
import urljoin from 'url-join';

const { isTrashPage } = pagePathUtils;

/**
 * Linked Array Structured PagePath Model
 */
export class LinkedPagePath {
  readonly path: string;

  readonly pathName: string;

  readonly parent?: LinkedPagePath;

  constructor(path: string) {
    const pagePath = new DevidedPagePath(path);

    this.path = path;
    this.pathName = pagePath.latter;
    this.parent = pagePath.isRoot
      ? undefined
      : new LinkedPagePath(pagePath.former);
  }

  get isRoot(): boolean {
    return this.parent == null;
  }

  get href(): string {
    if (this.parent == null) {
      return '/';
    }

    return pathUtils.normalizePath(`${this.parent.href}/${this.pathName}`);
  }

  get isInTrash(): boolean {
    return isTrashPage(this.path);
  }
}

/**
 * Build a navigable href for a `LinkedPagePath` node, joined onto an optional
 * base path and percent-encoded. Shared by `PagePathHierarchicalLink` and
 * `buildAncestorPathNodes` so the two ancestor-breadcrumb renderers stay in
 * sync on how a link target is derived from a `LinkedPagePath`.
 */
export const buildLinkedPagePathHref = (
  linkedPagePath: LinkedPagePath,
  basePath?: string,
): string => encodeURI(urljoin(basePath || '/', linkedPagePath.href));
