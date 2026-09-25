import type { IUserHasId } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import UserGroupRelation from '~/server/models/user-group-relation';

import { findUserGroupIdsForViewer } from './find-user-group-ids-for-viewer';

/*
 * The group ids every viewer-filtered backlinks read is handed: a GRANT_USER_GROUP page
 * is readable through an internal or an external group alike, so both must be in it.
 */
describe('findUserGroupIdsForViewer (integration)', () => {
  const USERNAMES = ['fugiv-member', 'fugiv-loner'];

  // biome-ignore lint/suspicious/noExplicitAny: the User model is an untyped JS model in GROWI; typing it precisely fights mongoose generics for no gain in a test.
  let User: any;
  let member: IUserHasId;
  let loner: IUserHasId;

  beforeAll(async () => {
    await getInstance();
    User = mongoose.model('User');

    // Leftovers from an aborted run would trip the unique username/email index.
    await User.deleteMany({ username: { $in: USERNAMES } });
    await User.insertMany(
      USERNAMES.map((name) => ({
        name,
        username: name,
        email: `${name}@example.com`,
      })),
    );
    member = await User.findOne({ username: 'fugiv-member' });
    loner = await User.findOne({ username: 'fugiv-loner' });
  });

  afterEach(async () => {
    const userIds = [member._id, loner._id];
    await UserGroupRelation.deleteMany({ relatedUser: { $in: userIds } });
    await ExternalUserGroupRelation.deleteMany({
      relatedUser: { $in: userIds },
    });
  });

  afterAll(async () => {
    await User.deleteMany({ username: { $in: USERNAMES } });
  });

  it('holds both the internal and the external groups the user belongs to', async () => {
    const internalGroupId = new mongoose.Types.ObjectId();
    const externalGroupId = new mongoose.Types.ObjectId();
    await UserGroupRelation.create({
      relatedGroup: internalGroupId,
      relatedUser: member._id,
    });
    await ExternalUserGroupRelation.create({
      relatedGroup: externalGroupId,
      relatedUser: member._id,
    });
    // Another user's membership must not leak into this user's list.
    await UserGroupRelation.create({
      relatedGroup: new mongoose.Types.ObjectId(),
      relatedUser: loner._id,
    });

    const groupIds = await findUserGroupIdsForViewer(member);

    expect(groupIds?.map(String).sort()).toEqual(
      [internalGroupId, externalGroupId].map(String).sort(),
    );
  });

  // Not null: downstream reads take null for a signed-in user as "look it up yourself".
  it('is an empty list for a signed-in user in no group', async () => {
    expect(await findUserGroupIdsForViewer(member)).toEqual([]);
  });

  it('is null for a guest', async () => {
    expect(await findUserGroupIdsForViewer(null)).toBeNull();
  });
});
