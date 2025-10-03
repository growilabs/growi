import type { IGrantedGroup } from '@growi/core';
import { GroupType, getIdForRef, type IPage, PageGrant } from '@growi/core';
import mongoose from 'mongoose';
import { PageActionOnGroupDelete } from '../../../src/interfaces/user-group';
import type Crowi from '../../../src/server/crowi';
import type { PageDocument, PageModel } from '../../../src/server/models/page';
import UserGroup from '../../../src/server/models/user-group';
import UserGroupRelation from '../../../src/server/models/user-group-relation';
import type { IUserGroupService } from '../../../src/server/service/user-group';
import { getInstance } from '../setup-crowi';

describe('UserGroupService', () => {
  let crowi: Crowi;
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let User;
  let Page: PageModel;

  let userGroupService: IUserGroupService;

  const groupId1 = new mongoose.Types.ObjectId();
  const groupId2 = new mongoose.Types.ObjectId();
  const groupId3 = new mongoose.Types.ObjectId();
  const groupId4 = new mongoose.Types.ObjectId();
  const groupId5 = new mongoose.Types.ObjectId();
  const groupId6 = new mongoose.Types.ObjectId();
  const groupId7 = new mongoose.Types.ObjectId();
  const groupId8 = new mongoose.Types.ObjectId();
  const groupId9 = new mongoose.Types.ObjectId();
  const groupId10 = new mongoose.Types.ObjectId();
  const groupId11 = new mongoose.Types.ObjectId();
  const groupId12 = new mongoose.Types.ObjectId();
  const groupId13 = new mongoose.Types.ObjectId();
  const groupId14 = new mongoose.Types.ObjectId();
  const groupId15 = new mongoose.Types.ObjectId();

  const userId1 = new mongoose.Types.ObjectId();
  // biome-ignore lint/suspicious/noImplicitAnyLet: ignore
  let user1;

  const pageId1 = new mongoose.Types.ObjectId();
  const pageId2 = new mongoose.Types.ObjectId();

  let rootPage: PageDocument | null;

  // normalize for result comparison
  const normalizeGrantedGroups = (
    grantedGroups: IGrantedGroup[] | undefined,
  ) => {
    if (grantedGroups == null) {
      return null;
    }
    return grantedGroups.map((group) => {
      return { item: getIdForRef(group.item), type: group.type };
    });
  };

  beforeAll(async () => {
    crowi = await getInstance();
    User = mongoose.model('User');
    Page = mongoose.model<IPage, PageModel>('Page');

    rootPage = await Page.findOne({ path: '/' });
    userGroupService = crowi.userGroupService!;

    await User.insertMany([
      // ug -> User Group
      {
        _id: userId1,
        name: 'ug_test_user1',
        username: 'ug_test_user1',
        email: 'ug_test_user1@example.com',
      },
    ]);
    user1 = await User.findOne({ _id: userId1 });

    // Create Groups
    await UserGroup.insertMany([
      // No parent
      {
        _id: groupId1,
        name: 'v5_group1',
        description: 'description1',
      },
      // No parent
      {
        _id: groupId2,
        name: 'v5_group2',
        description: 'description2',
      },
      // No parent
      {
        _id: groupId3,
        name: 'v5_group3',
        description: 'description3',
      },
      // No parent
      {
        _id: groupId4,
        name: 'v5_group4',
        description: 'description4',
      },
      // No parent
      {
        _id: groupId5,
        name: 'v5_group5',
        description: 'description5',
      },
      // No parent
      {
        _id: groupId6,
        name: 'v5_group6',
        description: 'description6',
      },
      // No parent
      {
        _id: groupId7,
        name: 'v5_group7',
        description: 'description7',
        parent: groupId6,
      },
      // No parent
      {
        _id: groupId8,
        name: 'v5_group8',
        description: 'description8',
      },
      {
        _id: groupId9,
        name: 'v5_group9',
        description: 'description9',
      },
      {
        _id: groupId10,
        name: 'v5_group10',
        description: 'description10',
        parent: groupId9,
      },
      {
        _id: groupId11,
        name: 'v5_group11',
        description: 'descriptio11',
      },
      {
        _id: groupId12,
        name: 'v5_group12',
        description: 'description12',
        parent: groupId11,
      },
      // for removeCompletelyByRootGroupId test
      {
        _id: groupId13,
        name: 'v5_group13',
        description: 'description13',
      },
      {
        _id: groupId14,
        name: 'v5_group14',
        description: 'description14',
        parent: groupId13,
      },
      {
        _id: groupId15,
        name: 'v5_group15',
        description: 'description15',
        parent: groupId15,
      },
    ]);

    // Create UserGroupRelations
    await UserGroupRelation.insertMany([
      {
        relatedGroup: groupId4,
        relatedUser: userId1,
      },
      {
        relatedGroup: groupId6,
        relatedUser: userId1,
      },
      {
        relatedGroup: groupId8,
        relatedUser: userId1,
      },
      {
        relatedGroup: groupId9,
        relatedUser: userId1,
      },
      {
        relatedGroup: groupId10,
        relatedUser: userId1,
      },
      {
        relatedGroup: groupId11,
        relatedUser: userId1,
      },
      {
        relatedGroup: groupId12,
        relatedUser: userId1,
      },
    ]);

    await Page.insertMany([
      {
        _id: pageId1,
        path: '/canBePublicized',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: userId1,
        lastUpdateUser: userId1,
        grantedGroups: [
          { item: groupId13, type: GroupType.userGroup },
          { item: groupId14, type: GroupType.userGroup },
        ],
        parent: rootPage?._id,
      },
      {
        _id: pageId2,
        path: '/cannotBePublicized',
        grant: PageGrant.GRANT_USER_GROUP,
        creator: userId1,
        lastUpdateUser: userId1,
        grantedGroups: [
          { item: groupId13, type: GroupType.userGroup },
          { item: groupId15, type: GroupType.userGroup },
        ],
        parent: rootPage?._id,
      },
    ]);
  });

  /*
   * Update UserGroup
   */
  describe('updateGroup', () => {
    test('Updated values should be reflected. (name, description, parent)', async () => {
      const userGroup2 = await UserGroup.findOne({ _id: groupId2 });

      const newGroupName = 'v5_group1_new';
      const newGroupDescription = 'description1_new';
      const newParentId = userGroup2?._id;

      const updatedUserGroup = await userGroupService.updateGroup(
        groupId1,
        newGroupName,
        newGroupDescription,
        newParentId,
      );

      expect(updatedUserGroup.name).toBe(newGroupName);
      expect(updatedUserGroup.description).toBe(newGroupDescription);
      expect(updatedUserGroup.parent).toStrictEqual(newParentId);
    });

    test('Should throw an error when trying to set existing group name', async () => {
      const userGroup2 = await UserGroup.findOne({ _id: groupId2 });

      const result = userGroupService.updateGroup(groupId1, userGroup2?.name);

      await expect(result).rejects.toThrow('The group name is already taken');
    });

    test('Parent should be null when parent group is released', async () => {
      const userGroup = await UserGroup.findOne({ _id: groupId3 });
      const updatedUserGroup = await userGroupService.updateGroup(
        userGroup?._id,
        userGroup?.name,
        userGroup?.description,
        null,
      );

      expect(updatedUserGroup.parent).toBeNull();
    });

    /*
     * forceUpdateParents: false
     */
    test('Should throw an error when users in child group do not exist in parent group', async () => {
      const userGroup4 = await UserGroup.findOne({
        _id: groupId4,
        parent: null,
      });
      const result = userGroupService.updateGroup(
        userGroup4?._id,
        userGroup4?.name,
        userGroup4?.description,
        groupId5,
      );

      await expect(result).rejects.toThrow(
        'The parent group does not contain the users in this group.',
      );
    });

    /*
     * forceUpdateParents: true
     */
    test('User should be included to parent group (2 groups ver)', async () => {
      const userGroup4 = await UserGroup.findOne({
        _id: groupId4,
        parent: null,
      });
      const userGroup5 = await UserGroup.findOne({
        _id: groupId5,
        parent: null,
      });
      // userGroup4 has userId1
      const userGroupRelation4BeforeUpdate = await UserGroupRelation.findOne({
        relatedGroup: userGroup4,
        relatedUser: userId1,
      });
      expect(userGroupRelation4BeforeUpdate).not.toBeNull();

      // userGroup5 has not userId1
      const userGroupRelation5BeforeUpdate = await UserGroupRelation.findOne({
        relatedGroup: userGroup5,
        relatedUser: userId1,
      });
      expect(userGroupRelation5BeforeUpdate).toBeNull();

      // update userGroup4's parent with userGroup5 (forceUpdate: true)
      const forceUpdateParents = true;
      const updatedUserGroup = await userGroupService.updateGroup(
        userGroup4?._id,
        userGroup4?.name,
        userGroup4?.description,
        groupId5,
        forceUpdateParents,
      );

      expect(updatedUserGroup.parent).toStrictEqual(groupId5);
      // userGroup5 should have userId1
      const userGroupRelation5AfterUpdate = await UserGroupRelation.findOne({
        relatedGroup: groupId5,
        relatedUser: userGroupRelation4BeforeUpdate?.relatedUser,
      });
      expect(userGroupRelation5AfterUpdate).not.toBeNull();
    });

    test('User should be included to parent group (3 groups ver)', async () => {
      const userGroup8 = await UserGroup.findOne({
        _id: groupId8,
        parent: null,
      });

      // userGroup7 has not userId1
      const userGroupRelation6BeforeUpdate = await UserGroupRelation.findOne({
        relatedGroup: groupId6,
        relatedUser: userId1,
      });
      const userGroupRelation7BeforeUpdate = await UserGroupRelation.findOne({
        relatedGroup: groupId7,
        relatedUser: userId1,
      });
      const userGroupRelation8BeforeUpdate = await UserGroupRelation.findOne({
        relatedGroup: groupId8,
        relatedUser: userId1,
      });
      expect(userGroupRelation6BeforeUpdate).not.toBeNull();
      // userGroup7 does not have userId1
      expect(userGroupRelation7BeforeUpdate).toBeNull();
      expect(userGroupRelation8BeforeUpdate).not.toBeNull();

      // update userGroup8's parent with userGroup7 (forceUpdate: true)
      const forceUpdateParents = true;
      await userGroupService.updateGroup(
        userGroup8?._id,
        userGroup8?.name,
        userGroup8?.description,
        groupId7,
        forceUpdateParents,
      );

      const userGroupRelation6AfterUpdate = await UserGroupRelation.findOne({
        relatedGroup: groupId6,
        relatedUser: userId1,
      });
      const userGroupRelation7AfterUpdate = await UserGroupRelation.findOne({
        relatedGroup: groupId7,
        relatedUser: userId1,
      });
      const userGroupRelation8AfterUpdate = await UserGroupRelation.findOne({
        relatedGroup: groupId8,
        relatedUser: userId1,
      });
      expect(userGroupRelation6AfterUpdate).not.toBeNull();
      // userGroup7 should have userId1
      expect(userGroupRelation7AfterUpdate).not.toBeNull();
      expect(userGroupRelation8AfterUpdate).not.toBeNull();
    });

    test('Should throw an error when trying to choose parent from descendant groups.', async () => {
      const userGroup9 = await UserGroup.findOne({
        _id: groupId9,
        parent: null,
      });
      const userGroup10 = await UserGroup.findOne({
        _id: groupId10,
        parent: groupId9,
      });

      const userGroupRelation9BeforeUpdate = await UserGroupRelation.findOne({
        relatedGroup: userGroup9?._id,
        relatedUser: userId1,
      });
      const userGroupRelation10BeforeUpdate = await UserGroupRelation.findOne({
        relatedGroup: userGroup10?._id,
        relatedUser: userId1,
      });
      expect(userGroupRelation9BeforeUpdate).not.toBeNull();
      expect(userGroupRelation10BeforeUpdate).not.toBeNull();

      const result = userGroupService.updateGroup(
        userGroup9?._id,
        userGroup9?.name,
        userGroup9?.description,
        userGroup10?._id,
      );
      await expect(result).rejects.toThrow(
        'It is not allowed to choose parent from descendant groups.',
      );
    });
  });

  describe('removeUserByUsername', () => {
    test('User should be deleted from child groups when the user excluded from the parent group', async () => {
      const userGroup11 = await UserGroup.findOne({
        _id: groupId11,
        parent: null,
      });
      const userGroup12 = await UserGroup.findOne({
        _id: groupId12,
        parent: groupId11,
      });

      // Both groups have user1
      const userGroupRelation11BeforeRemove = await UserGroupRelation.findOne({
        relatedGroup: userGroup11?._id,
        relatedUser: userId1,
      });
      const userGroupRelation12BeforeRemove = await UserGroupRelation.findOne({
        relatedGroup: userGroup12?._id,
        relatedUser: userId1,
      });
      expect(userGroupRelation11BeforeRemove).not.toBeNull();
      expect(userGroupRelation12BeforeRemove).not.toBeNull();

      // remove user1 from the parent group
      await userGroupService.removeUserByUsername(
        userGroup11?._id,
        'ug_test_user1',
      );

      // Both groups have not user1
      const userGroupRelation11AfterRemove = await UserGroupRelation.findOne({
        relatedGroup: userGroup11?._id,
        relatedUser: userId1,
      });
      const userGroupRelation12AfterRemove = await UserGroupRelation.findOne({
        relatedGroup: userGroup12?._id,
        relatedUser: userId1,
      });
      await expect(userGroupRelation11AfterRemove).toBeNull();
      await expect(userGroupRelation12AfterRemove).toBeNull();
    });
  });

  describe('removeCompletelyByRootGroupId', () => {
    describe('when action is public', () => {
      test('Should remove the group and its descendants and publicize pages that are only visible to the groups to be removed', async () => {
        const userGroup13 = await UserGroup.findOne({ _id: groupId13 });
        const userGroup14 = await UserGroup.findOne({ _id: groupId14 });
        expect(userGroup13).not.toBeNull();
        expect(userGroup14).not.toBeNull();

        const canBePublicized = await Page.findOne({ _id: pageId1 });
        const cannotBePublicized = await Page.findOne({ _id: pageId2 });
        expect(canBePublicized?.grant).toBe(PageGrant.GRANT_USER_GROUP);
        expect(normalizeGrantedGroups(canBePublicized?.grantedGroups)).toEqual(
          expect.arrayContaining([
            { item: groupId13, type: GroupType.userGroup },
            { item: groupId14, type: GroupType.userGroup },
          ]),
        );
        expect(
          normalizeGrantedGroups(canBePublicized?.grantedGroups)?.length,
        ).toBe(2);
        expect(cannotBePublicized?.grant).toBe(PageGrant.GRANT_USER_GROUP);
        expect(
          normalizeGrantedGroups(cannotBePublicized?.grantedGroups),
        ).toEqual(
          expect.arrayContaining([
            { item: groupId13, type: GroupType.userGroup },
            { item: groupId15, type: GroupType.userGroup },
          ]),
        );
        expect(
          normalizeGrantedGroups(cannotBePublicized?.grantedGroups)?.length,
        ).toBe(2);

        await userGroupService.removeCompletelyByRootGroupId(
          groupId13,
          PageActionOnGroupDelete.publicize,
          user1,
        );

        const userGroup13AfterDeleteProcess = await UserGroup.findOne({
          _id: groupId13,
        });
        const userGroup14AfterDeleteProcess = await UserGroup.findOne({
          _id: groupId14,
        });
        expect(userGroup13AfterDeleteProcess).toBeNull();
        expect(userGroup14AfterDeleteProcess).toBeNull();

        const canBePublicizedAfterDeleteProcess = await Page.findOne({
          _id: pageId1,
        });
        const cannotBePublicizedAfterDeleteProcess = await Page.findOne({
          _id: pageId2,
        });
        expect(canBePublicizedAfterDeleteProcess?.grant).toBe(
          PageGrant.GRANT_PUBLIC,
        );
        expect(
          normalizeGrantedGroups(
            canBePublicizedAfterDeleteProcess?.grantedGroups,
          ),
        ).toEqual([]);
        expect(cannotBePublicizedAfterDeleteProcess?.grant).toBe(
          PageGrant.GRANT_USER_GROUP,
        );
        expect(
          normalizeGrantedGroups(
            cannotBePublicizedAfterDeleteProcess?.grantedGroups,
          ),
        ).toEqual(
          expect.arrayContaining([
            { item: groupId15, type: GroupType.userGroup },
          ]),
        );
        expect(
          normalizeGrantedGroups(
            cannotBePublicizedAfterDeleteProcess?.grantedGroups,
          )?.length,
        ).toBe(1);
      });
    });
  });
});
