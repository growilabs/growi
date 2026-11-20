import type { IUser } from '@growi/core';
import {
  isUserPage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import { configManager } from '~/server/service/config-manager';

export type UserPageWriteRefusal =
  | 'user-pages-disabled'
  | 'user-home-owner-missing';

type UserModelWithHomeLookup = Model<IUser> & {
  isExistUserByUserPagePath(path: string): Promise<boolean>;
};

const isDisabledUserPagePath = (path: string): boolean =>
  configManager.getConfig('security:disableUserPages') &&
  (isUsersTopPage(path) || isUserPage(path));

/**
 * The user-page rules the human page routes apply before a write:
 * - `existingPath`: a page written in place or moved away; refused while user
 *   pages are disabled (update-page, duplicate's source)
 * - `newPath`: a path a page is created at or moved to; refused while user pages
 *   are disabled, and under a user home whose owner does not exist (create-page,
 *   duplicate's destination). The rename route checks only the owner.
 * The routes still inline these checks; keep both in step.
 */
export const findUserPageWriteRefusal = async (paths: {
  readonly existingPath?: string;
  readonly newPath?: string;
}): Promise<UserPageWriteRefusal | null> => {
  const { existingPath, newPath } = paths;
  const touched = [existingPath, newPath].filter(
    (path): path is string => path != null,
  );
  if (touched.some(isDisabledUserPagePath)) {
    return 'user-pages-disabled';
  }
  if (newPath != null && isUserPage(newPath)) {
    const User = mongoose.model<IUser, UserModelWithHomeLookup>('User');
    if (!(await User.isExistUserByUserPagePath(newPath))) {
      return 'user-home-owner-missing';
    }
  }
  return null;
};
