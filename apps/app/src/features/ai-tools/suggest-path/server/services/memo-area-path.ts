import { userHomepagePath } from '@growi/core/dist/utils/page-path-utils';

/**
 * The user's memo area, with a trailing slash: under the user's homepage, or
 * `/memo/<username>/` when user pages are disabled.
 */
export const memoAreaPath = (
  user: { readonly username: string },
  disableUserPages: boolean,
): string =>
  disableUserPages
    ? `/memo/${user.username}/`
    : `${userHomepagePath(user)}/memo/`;
