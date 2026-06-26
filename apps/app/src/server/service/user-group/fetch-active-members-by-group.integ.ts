import { GroupType } from '@growi/core';
import mongoose, { type Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';

import { fetchActiveMembersByGroup } from './fetch-active-members-by-group';

type UserInsertFields = {
  _id: Types.ObjectId;
  name: string;
  username: string;
  email: string;
};

describe('fetchActiveMembersByGroup', () => {
  const groupId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await getInstance();
    const User = mongoose.model<UserInsertFields>('User');

    await User.insertMany([
      {
        _id: userId,
        name: 'Privacy Test User',
        username: 'fetch_members_integ_user',
        email: 'privacy-integ@example.com',
      },
    ]);

    await UserGroup.insertMany([
      { _id: groupId, name: 'fetch-members-integ-group' },
    ]);

    await UserGroupRelation.insertMany([
      { relatedGroup: groupId, relatedUser: userId },
    ]);
  });

  it('returns only name and username — email is not present in result (privacy projection)', async () => {
    const groupDoc = await UserGroup.findById(groupId);
    if (groupDoc == null) throw new Error('test group not found');
    const group: PopulatedGrantedGroup = {
      type: GroupType.userGroup,
      item: groupDoc,
    };

    const result = await fetchActiveMembersByGroup([group]);

    const members = result[groupId.toString()];
    expect(members).toHaveLength(1);
    const member = members[0];
    expect(member).toEqual({
      name: 'Privacy Test User',
      username: 'fetch_members_integ_user',
    });
    expect('email' in member).toBe(false);
  });
});
