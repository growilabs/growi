import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import UserGroupRelation from '~/server/models/user-group-relation';

import { getOrCreateModel } from '../../../../server/util/mongoose-utils';
import type { IExternalUserGroupRelation } from '../../interfaces/external-user-group';

import type { ExternalUserGroupDocument } from './external-user-group';

export interface ExternalUserGroupRelationDocument
  extends IExternalUserGroupRelation,
    Document {}

export interface ExternalUserGroupRelationModel
  extends Model<ExternalUserGroupRelationDocument> {
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  [x: string]: any; // for old methods

  PAGE_ITEMS: 50;

  removeAllByUserGroups: (
    groupsToDelete: ExternalUserGroupDocument[],
  ) => Promise<any>;

  findAllUserIdsForUserGroups: (
    userGroupIds: ObjectIdLike[],
  ) => Promise<string[]>;

  findGroupsWithDescendantsByGroupAndUser: (
    group: ExternalUserGroupDocument,
    user,
  ) => Promise<ExternalUserGroupDocument[]>;

  countByGroupIdsAndUser: (
    userGroupIds: ObjectIdLike[],
    userData,
  ) => Promise<number>;

  findAllGroupsForUser: (user) => Promise<ExternalUserGroupDocument[]>;

  findAllUserGroupIdsRelatedToUser: (user) => Promise<ObjectIdLike[]>;
}

const schema = new Schema<
  ExternalUserGroupRelationDocument,
  ExternalUserGroupRelationModel
>(
  {
    relatedGroup: {
      type: Schema.Types.ObjectId,
      ref: 'ExternalUserGroup',
      required: true,
    },
    relatedUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

schema.statics.createRelations = UserGroupRelation.createRelations;

schema.statics.removeAllByUserGroups = UserGroupRelation.removeAllByUserGroups;

schema.statics.findAllRelation = UserGroupRelation.findAllRelation;

schema.statics.removeAllInvalidRelations =
  UserGroupRelation.removeAllInvalidRelations;

schema.statics.findGroupsWithDescendantsByGroupAndUser =
  UserGroupRelation.findGroupsWithDescendantsByGroupAndUser;

schema.statics.countByGroupIdsAndUser =
  UserGroupRelation.countByGroupIdsAndUser;

schema.statics.findAllUserIdsForUserGroups =
  UserGroupRelation.findAllUserIdsForUserGroups;

schema.statics.findAllUserGroupIdsRelatedToUser =
  UserGroupRelation.findAllUserGroupIdsRelatedToUser;

schema.statics.findAllGroupsForUser = UserGroupRelation.findAllGroupsForUser;

export default getOrCreateModel<
  ExternalUserGroupRelationDocument,
  ExternalUserGroupRelationModel
>('ExternalUserGroupRelation', schema);
