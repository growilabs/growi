import mongoose from 'mongoose';

import ExternalUserGroup from './external-user-group';

describe('ExternalUserGroup model', () => {
  describe('findAndUpdateOrCreateGroup', () => {
    const groupId = new mongoose.Types.ObjectId();
    beforeAll(async () => {
      await ExternalUserGroup.create({
        _id: groupId,
        name: 'test group',
        externalId: 'testExternalId',
        provider: 'testProvider',
      });
    });

    it('finds and updates existing group', async () => {
      const group = await ExternalUserGroup.findAndUpdateOrCreateGroup(
        'edited test group',
        'testExternalId',
        'testProvider',
      );
      expect(group.id).toBe(groupId.toString());
      expect(group.name).toBe('edited test group');
    });

    it('creates new group with parent', async () => {
      expect(await ExternalUserGroup.count()).toBe(1);
      const newGroup = await ExternalUserGroup.findAndUpdateOrCreateGroup(
        'new group',
        'nonExistentExternalId',
        'testProvider',
        undefined,
        groupId.toString(),
      );
      expect(await ExternalUserGroup.count()).toBe(2);
      expect(newGroup.parent.toString()).toBe(groupId.toString());
    });

    it('throws error when parent does not exist', async () => {
      try {
        await ExternalUserGroup.findAndUpdateOrCreateGroup(
          'new group',
          'nonExistentExternalId',
          'testProvider',
          undefined,
          new mongoose.Types.ObjectId(),
        );
      } catch (e) {
        expect(e.message).toBe('Parent does not exist.');
      }
    });
  });

  describe('findGroupsWithAncestorsRecursively', () => {
    const childGroupId = new mongoose.Types.ObjectId();
    const parentGroupId = new mongoose.Types.ObjectId();
    const grandParentGroupId = new mongoose.Types.ObjectId();

    beforeAll(async () => {
      await ExternalUserGroup.deleteMany();
      await ExternalUserGroup.create({
        _id: grandParentGroupId,
        name: 'grand parent group',
        externalId: 'grandParentExternalId',
        provider: 'testProvider',
      });
      await ExternalUserGroup.create({
        _id: parentGroupId,
        name: 'parent group',
        externalId: 'parentExternalId',
        provider: 'testProvider',
        parent: grandParentGroupId,
      });
      await ExternalUserGroup.create({
        _id: childGroupId,
        name: 'child group',
        externalId: 'childExternalId',
        provider: 'testProvider',
        parent: parentGroupId,
      });
    });

    it('finds ancestors for child', async () => {
      const childGroup = await ExternalUserGroup.findById(childGroupId);
      const groups =
        await ExternalUserGroup.findGroupsWithAncestorsRecursively(childGroup);
      const groupIds = groups.map((group) => group.id);
      expect(groupIds).toStrictEqual([
        grandParentGroupId.toString(),
        parentGroupId.toString(),
        childGroupId.toString(),
      ]);
    });

    it('finds ancestors for child, excluding child', async () => {
      const childGroup = await ExternalUserGroup.findById(childGroupId);
      const groups = await ExternalUserGroup.findGroupsWithAncestorsRecursively(
        childGroup,
        [],
      );
      const groupIds = groups.map((group) => group.id);
      expect(groupIds).toStrictEqual([
        grandParentGroupId.toString(),
        parentGroupId.toString(),
      ]);
    });
  });
});
