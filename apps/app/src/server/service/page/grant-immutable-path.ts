import {
  isTopPage,
  isUsersProtectedPages,
} from '@growi/core/dist/utils/page-path-utils';

/** Pages whose grant must stay as created: the top page, /user and every user homepage. */
export const isGrantImmutablePath = (path: string): boolean =>
  isTopPage(path) || isUsersProtectedPages(path);
