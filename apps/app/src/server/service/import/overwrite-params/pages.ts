import { PageGrant } from '@growi/core';
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
    params.creator = userId;
    params.lastUpdateUser = userId;
  }

  params.grant = (value, { document, schema, propertyName }) => {
    if (option.makePublicForGrant2 && value === 2) {
      return PageGrant.GRANT_PUBLIC;
    }
    if (option.makePublicForGrant4 && value === 4) {
      return PageGrant.GRANT_PUBLIC;
    }
    if (option.makePublicForGrant5 && value === 5) {
      return PageGrant.GRANT_PUBLIC;
    }
    return value;
  };

  params.parent = (value, { document, schema, propertyName }) => {
    return null;
  };

  params.descendantCount = (value, { document, schema, propertyName }) => {
    return 0;
  };

  if (option.initPageMetadatas) {
    params.liker = [];
    params.seenUsers = [];
    params.commentCount = 0;
    params.extended = {};
  }

  return params;
};
