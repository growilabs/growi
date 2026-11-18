import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';

import type { ViewerIdentity } from '../domain';
import { loadViewablePages } from './current-page-facts';
import { loadViewerIdentity } from './reviewer-identity';

const PREFIX = '/cp-reviewer-identity-integ';

describe('loadViewerIdentity', () => {
  let Page: PageModel;
  let member: HydratedDocument<IUserHasId>;
  let loner: HydratedDocument<IUserHasId>;
  let groupId: string;
  let externalGroupId: string;
  let seq = 0;

  const groupPage = (
    type: GroupType,
    item: string,
  ): Promise<HydratedDocument<PageDocument>> => {
    seq += 1;
    return Page.create({
      path: `${PREFIX}/group-page-${seq}`,
      grant: PageGrant.GRANT_USER_GROUP,
      grantedGroups: [{ item, type }],
      isEmpty: false,
    });
  };

  const viewableIdsOf = async (
    pageIds: readonly string[],
    viewer: IUserHasId,
    identity?: ViewerIdentity,
  ): Promise<string[]> => [
    ...(await loadViewablePages(pageIds, viewer, identity)).viewablePageIds,
  ];

  beforeAll(async () => {
    await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    const User = mongoose.model<IUserHasId>('User');
    [member, loner] = await Promise.all(
      ['cpIdentityMember', 'cpIdentityLoner'].map((username) =>
        User.create({
          name: username,
          username,
          email: `${username}@example.com`,
          status: UserStatus.STATUS_ACTIVE,
        }),
      ),
    );
    groupId = (
      await UserGroup.create({ name: 'cpIdentityGroup' })
    )._id.toString();
    externalGroupId = (
      await ExternalUserGroup.create({
        name: 'cpIdentityExternalGroup',
        externalId: 'cp-identity-external',
        provider: 'ldap',
      })
    )._id.toString();
    await UserGroupRelation.create({
      relatedGroup: groupId,
      relatedUser: member._id,
    });
    await ExternalUserGroupRelation.create({
      relatedGroup: externalGroupId,
      relatedUser: member._id,
    });
  });

  afterAll(async () => {
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}/`) });
    await UserGroupRelation.deleteMany({ relatedGroup: groupId });
    await ExternalUserGroupRelation.deleteMany({
      relatedGroup: externalGroupId,
    });
    await UserGroup.deleteMany({ _id: groupId });
    await ExternalUserGroup.deleteMany({ _id: externalGroupId });
    await mongoose
      .model('User')
      .deleteMany({ _id: { $in: [member._id, loner._id] } });
  });

  it('reads user groups and external groups into separate sets (Req 16.4)', async () => {
    const identity = await loadViewerIdentity(member._id.toString());

    expect(identity).toEqual({
      userId: member._id.toString(),
      userGroupIds: new Set([groupId]),
      externalUserGroupIds: new Set([externalGroupId]),
    });
  });

  it('reads no groups for a user who belongs to none', async () => {
    expect(await loadViewerIdentity(loner._id.toString())).toEqual({
      userId: loner._id.toString(),
      userGroupIds: new Set(),
      externalUserGroupIds: new Set(),
    });
  });

  it('stops counting a group once the membership is removed (Req 19.9)', async () => {
    const temporary = await UserGroup.create({ name: 'cpIdentityTemporary' });
    try {
      await UserGroupRelation.create({
        relatedGroup: temporary._id,
        relatedUser: loner._id,
      });
      const before = await loadViewerIdentity(loner._id.toString());
      await UserGroupRelation.deleteMany({ relatedGroup: temporary._id });
      const after = await loadViewerIdentity(loner._id.toString());

      expect(before.userGroupIds).toEqual(new Set([temporary._id.toString()]));
      expect(after.userGroupIds).toEqual(new Set());
    } finally {
      await UserGroupRelation.deleteMany({ relatedGroup: temporary._id });
      await UserGroup.deleteMany({ _id: temporary._id });
    }
  });

  describe('loadViewablePages with an already loaded identity', () => {
    it('judges group pages by the given membership instead of reading it again', async () => {
      const userGroupPage = await groupPage(GroupType.userGroup, groupId);
      const externalGroupPage = await groupPage(
        GroupType.externalUserGroup,
        externalGroupId,
      );
      const ids = [userGroupPage, externalGroupPage].map((p) =>
        p._id.toString(),
      );
      const noGroups: ViewerIdentity = {
        userId: member._id.toString(),
        userGroupIds: new Set(),
        externalUserGroupIds: new Set(),
      };
      const borrowedGroups: ViewerIdentity = {
        userId: loner._id.toString(),
        userGroupIds: new Set([groupId]),
        externalUserGroupIds: new Set([externalGroupId]),
      };

      // The database says member belongs to both groups and loner to neither.
      expect(await viewableIdsOf(ids, member, noGroups)).toEqual([]);
      expect((await viewableIdsOf(ids, loner, borrowedGroups)).sort()).toEqual(
        [...ids].sort(),
      );
    });

    it('still reads the membership itself when no identity is given', async () => {
      const page = await groupPage(GroupType.userGroup, groupId);
      const id = page._id.toString();

      expect(await viewableIdsOf([id], member)).toEqual([id]);
      expect(await viewableIdsOf([id], loner)).toEqual([]);
    });
  });
});
