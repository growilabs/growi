import { getIdForRef, isPopulated } from '@growi/core';
import type { IUserGroupRelation } from '@growi/core/dist/interfaces';
import type { Document, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import uniqueValidator from 'mongoose-unique-validator';

import loggerFactory from '~/utils/logger';

import type { ObjectIdLike } from '../interfaces/mongoose-utils';
import { getOrCreateModel } from '../util/mongoose-utils';
import type { UserGroupDocument } from './user-group';

const logger = loggerFactory('growi:models:userGroupRelation');

export interface UserGroupRelationDocument
  extends IUserGroupRelation,
    Document {}

export interface UserGroupRelationModel
  extends Model<UserGroupRelationDocument> {
  [x: string]: any; // for old methods

  PAGE_ITEMS: 50;

  removeAllByUserGroups: (groupsToDelete: UserGroupDocument[]) => Promise<any>;

  findAllUserIdsForUserGroups: (
    userGroupIds: ObjectIdLike[],
  ) => Promise<string[]>;

  findGroupsWithDescendantsByGroupAndUser: (
    group: UserGroupDocument,
    user,
  ) => Promise<UserGroupDocument[]>;

  countByGroupIdsAndUser: (
    userGroupIds: ObjectIdLike[],
    userData,
  ) => Promise<number>;

  findAllGroupsForUser: (user) => Promise<UserGroupDocument[]>;

  findAllUserGroupIdsRelatedToUser: (user) => Promise<ObjectIdLike[]>;
}

/*
 * define schema
 */
const schema = new Schema<UserGroupRelationDocument, UserGroupRelationModel>(
  {
    relatedGroup: {
      type: Schema.Types.ObjectId,
      ref: 'UserGroup',
      required: true,
    },
    relatedUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);
schema.plugin(mongoosePaginate);
schema.plugin(uniqueValidator);

/**
 * remove all invalid relations that has reference to unlinked document
 */
schema.statics.removeAllInvalidRelations = function () {
  return this.findAllRelation()
    .then((relations) => {
      // filter invalid documents
      return relations.filter((relation) => {
        return relation.relatedUser == null || relation.relatedGroup == null;
      });
    })
    .then((invalidRelations) => {
      const ids = invalidRelations.map((relation) => {
        return relation._id;
      });
      return this.deleteMany({ _id: { $in: ids } });
    });
};

/**
 * find all user and group relation
 *
 * @static
 * @returns {Promise<UserGroupRelation[]>}
 * @memberof UserGroupRelation
 */
schema.statics.findAllRelation = function () {
  return this.find().populate('relatedUser').populate('relatedGroup').exec();
};

/**
 * find all user and group relation of UserGroup
 *
 * @static
 * @param {UserGroup} userGroup
 * @returns {Promise<UserGroupRelation[]>}
 * @memberof UserGroupRelation
 */
schema.statics.findAllRelationForUserGroup = function (userGroup) {
  logger.debug('findAllRelationForUserGroup is called', userGroup);
  return this.find({ relatedGroup: userGroup }).populate('relatedUser').exec();
};

schema.statics.findAllUserIdsForUserGroups = async function (
  userGroupIds: ObjectIdLike[],
): Promise<string[]> {
  const relations = await this.find({ relatedGroup: { $in: userGroupIds } })
    .select('relatedUser')
    .exec();

  // return unique ids
  return [...new Set(relations.map((r) => r.relatedUser.toString()))];
};

/**
 * find all user and group relation of UserGroups
 *
 * @static
 * @param {UserGroup[]} userGroups
 * @returns {Promise<UserGroupRelation[]>}
 * @memberof UserGroupRelation
 */
schema.statics.findAllRelationForUserGroups = function (userGroups) {
  return this.find({ relatedGroup: { $in: userGroups } })
    .populate('relatedUser')
    .exec();
};

/**
 * find all groups of User
 *
 * @static
 * @param {User} user
 * @returns {Promise<UserGroupDocument[]>}
 * @memberof UserGroupRelation
 */
schema.statics.findAllGroupsForUser = async function (
  user,
): Promise<UserGroupDocument[]> {
  const userGroupRelations = await this.find({
    relatedUser: user._id,
  }).populate('relatedGroup');
  const userGroups = userGroupRelations.map((relation) => {
    return isPopulated(relation.relatedGroup)
      ? (relation.relatedGroup as unknown as UserGroupDocument)
      : null;
  });
  return userGroups.filter(
    (group): group is NonNullable<UserGroupDocument> => group != null,
  );
};

/**
 * find all UserGroup IDs that related to specified User
 *
 * @static
 * @param {User} user
 * @returns {Promise<ObjectId[]>}
 */
schema.statics.findAllUserGroupIdsRelatedToUser = async function (
  user,
): Promise<ObjectIdLike[]> {
  const relations = await this.find({ relatedUser: user._id })
    .select('relatedGroup')
    .exec();

  return relations.map((relation) => {
    return getIdForRef(relation.relatedGroup);
  });
};

/**
 * count by related group id and related user
 *
 * @static
 * @param {string} userGroupId find query param for relatedGroup
 * @param {User} userData find query param for relatedUser
 * @returns {Promise<number>}
 */
schema.statics.countByGroupIdsAndUser = async function (
  userGroupIds: ObjectIdLike[],
  userData,
): Promise<number> {
  const query = {
    relatedGroup: { $in: userGroupIds },
    relatedUser: userData._id,
  };

  return this.count(query);
};

/**
 * find all "not" related user for UserGroup
 *
 * @static
 * @param {UserGroup} userGroup for find users not related
 * @returns {Promise<User>}
 * @memberof UserGroupRelation
 */
schema.statics.findUserByNotRelatedGroup = function (userGroup, queryOptions) {
  const User = mongoose.model('User') as any;
  let searchWord = new RegExp(`${queryOptions.searchWord}`);
  switch (queryOptions.searchType) {
    case 'forward':
      searchWord = new RegExp(`^${queryOptions.searchWord}`);
      break;
    case 'backword':
      searchWord = new RegExp(`${queryOptions.searchWord}$`);
      break;
  }
  const searthField: Record<string, RegExp>[] = [{ username: searchWord }];
  if (queryOptions.isAlsoMailSearched === 'true') {
    searthField.push({ email: searchWord });
  }
  if (queryOptions.isAlsoNameSearched === 'true') {
    searthField.push({ name: searchWord });
  }

  return this.findAllRelationForUserGroup(userGroup).then((relations) => {
    const relatedUserIds = relations.map((relation) => {
      return relation.relatedUser.id;
    });
    const query = {
      _id: { $nin: relatedUserIds },
      status: User.STATUS_ACTIVE,
      $or: searthField,
    };

    logger.debug('findUserByNotRelatedGroup ', query);
    return User.find(query).exec();
  });
};

/**
 * get if the user has relation for group
 *
 * @static
 * @param {UserGroup} userGroup
 * @param {User} user
 * @returns {Promise<boolean>} is user related for group(or not)
 * @memberof UserGroupRelation
 */
schema.statics.isRelatedUserForGroup = function (userGroup, user) {
  const query = {
    relatedGroup: userGroup.id,
    relatedUser: user.id,
  };

  return this.count(query)
    .exec()
    .then((count) => {
      // return true or false of the relation is exists(not count)
      return count > 0;
    });
};

/**
 * create user and group relation
 *
 * @static
 * @param {UserGroup} userGroup
 * @param {User} user
 * @returns {Promise<UserGroupRelation>} created relation
 * @memberof UserGroupRelation
 */
schema.statics.createRelation = function (userGroup, user) {
  return this.create({
    relatedGroup: userGroup.id,
    relatedUser: user.id,
  });
};

schema.statics.createRelations = async function (userGroupIds, user) {
  const documentsToInsertMany = userGroupIds.map((groupId) => {
    return {
      relatedGroup: groupId,
      relatedUser: user._id,
      createdAt: new Date(),
    };
  });

  return this.insertMany(documentsToInsertMany);
};

/**
 * remove all relation for UserGroup
 *
 * @static
 * @param {UserGroup} userGroup related group for remove
 * @returns {Promise<any>}
 * @memberof UserGroupRelation
 */
schema.statics.removeAllByUserGroups = function (
  groupsToDelete: UserGroupDocument[],
) {
  return this.deleteMany({ relatedGroup: { $in: groupsToDelete } });
};

/**
 * remove relation by id
 *
 * @static
 * @param {ObjectId} id
 * @returns {Promise<any>}
 * @memberof UserGroupRelation
 */
schema.statics.removeById = function (id) {
  return this.findById(id).then((relationData) => {
    if (relationData == null) {
      throw new Error('UserGroupRelation data is not exists. id:', id);
    } else {
      relationData.remove();
    }
  });
};

schema.statics.findUserIdsByGroupId = async function (groupId) {
  const relations = await this.find(
    { relatedGroup: groupId },
    { _id: 0, relatedUser: 1 },
  )
    .lean()
    .exec(); // .lean() to get not ObjectId but string

  return relations.map((relation) => relation.relatedUser);
};

schema.statics.createByGroupIdsAndUserIds = async function (groupIds, userIds) {
  const insertOperations: any[] = [];

  groupIds.forEach((groupId) => {
    userIds.forEach((userId) => {
      insertOperations.push({
        insertOne: {
          document: {
            relatedGroup: groupId,
            relatedUser: userId,
          },
        },
      });
    });
  });

  await this.bulkWrite(insertOperations);
};

/**
 * Recursively finds descendant groups by populating relations.
 * @static
 * @param {UserGroupDocument} group
 * @param {UserDocument} user
 * @returns UserGroupDocument[]
 */
schema.statics.findGroupsWithDescendantsByGroupAndUser = async function (
  group: UserGroupDocument,
  user,
): Promise<UserGroupDocument[]> {
  const descendantGroups = [group];

  const incrementGroupsRecursively = async (groups, user) => {
    const groupIds = groups.map((g) => g._id);

    const populatedRelations = await this.aggregate([
      {
        $match: {
          relatedUser: user._id,
        },
      },
      {
        $lookup: {
          from: this.collection.collectionName,
          localField: 'relatedGroup',
          foreignField: '_id',
          as: 'relatedGroup',
        },
      },
      {
        $unwind: {
          path: '$relatedGroup',
        },
      },
      {
        $match: {
          'relatedGroup.parent': { $in: groupIds },
        },
      },
    ]);

    const nextGroups = populatedRelations.map((d) => d.relatedGroup);

    // End
    const shouldEnd = nextGroups.length === 0;
    if (shouldEnd) {
      return;
    }

    // Increment
    descendantGroups.push(...nextGroups);

    return incrementGroupsRecursively(nextGroups, user);
  };

  await incrementGroupsRecursively([group], user);

  return descendantGroups;
};

export default getOrCreateModel<
  UserGroupRelationDocument,
  UserGroupRelationModel
>('UserGroupRelation', schema);
