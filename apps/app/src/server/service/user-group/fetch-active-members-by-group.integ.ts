import { GroupType } from '@growi/core';
import mongoose from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';

import { fetchActiveMembersByGroup } from './fetch-active-members-by-group';

describe('fetchActiveMembersByGroup', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let User: any;

  const groupId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await getInstance();
    User = mongoose.model('User');

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
    const group: PopulatedGrantedGroup = {
      type: GroupType.userGroup,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      item: { _id: groupId } as any,
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
