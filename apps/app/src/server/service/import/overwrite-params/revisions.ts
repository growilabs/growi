import { Types } from 'mongoose';

import type { ImportOptionForPages } from '~/models/admin/import-option-for-pages';

import type { OverwriteParams } from '../import-settings';

const { ObjectId } = Types;

export const generateOverwriteParams = (
  operatorUserId: string,
  option: ImportOptionForPages,
): OverwriteParams => {
  const params: OverwriteParams = {};

  if (option.isOverwriteAuthorWithCurrentUser) {
    const userId = new ObjectId(operatorUserId);
    params.author = userId;
  }

  return params;
};
