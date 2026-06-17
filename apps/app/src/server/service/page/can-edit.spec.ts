import { PageWriteGrant } from '@growi/core';

import { canEditPage } from './can-edit';

describe('canEditPage', () => {
  const adminUser = { _id: 'admin-id' as any, admin: true };
  const readOnlyUser = { _id: 'ro-id' as any, readOnly: true };
  const normalUser = { _id: 'user-id' as any };
  const otherUser = { _id: 'other-id' as any };
  const groupA = 'group-a-id' as any;
  const groupB = 'group-b-id' as any;

  const makePage = (overrides = {}) => ({
    writeGrant: PageWriteGrant.WRITE_GRANT_PUBLIC,
    writeGrantedUsers: [],
    writeGrantedGroups: [],
    readOnlyUserIds: [],
    ...overrides,
  });

  describe('null / admin / readOnly checks', () => {
    it('should return false when user is null', () => {
      expect(canEditPage({ user: null, page: makePage() })).toBe(false);
    });

    it('should return true when user is admin (ignores writeGrant)', () => {
      const page = makePage({
        writeGrant: PageWriteGrant.WRITE_GRANT_OWNER,
        writeGrantedUsers: [otherUser._id],
      });
      expect(canEditPage({ user: adminUser, page })).toBe(true);
    });

    it('should return false when user is readOnly', () => {
      const page = makePage({ writeGrant: PageWriteGrant.WRITE_GRANT_PUBLIC });
      expect(canEditPage({ user: readOnlyUser, page })).toBe(false);
    });
  });

  describe('readOnlyUserIds', () => {
    it('should return false when user is in readOnlyUserIds', () => {
      const page = makePage({ readOnlyUserIds: [normalUser._id, otherUser._id] });
      expect(canEditPage({ user: normalUser, page })).toBe(false);
    });

    it('should return true when user is not in readOnlyUserIds', () => {
      const page = makePage({ readOnlyUserIds: [otherUser._id] });
      expect(canEditPage({ user: normalUser, page })).toBe(true);
    });

    it('should return true when readOnlyUserIds is empty', () => {
      expect(canEditPage({ user: normalUser, page: makePage() })).toBe(true);
    });
  });

  describe('WRITE_GRANT_PUBLIC', () => {
    it('should return true for any user', () => {
      const page = makePage({ writeGrant: PageWriteGrant.WRITE_GRANT_PUBLIC });
      expect(canEditPage({ user: normalUser, page })).toBe(true);
    });
  });

  describe('WRITE_GRANT_OWNER', () => {
    it('should return true when user is in writeGrantedUsers', () => {
      const page = makePage({
        writeGrant: PageWriteGrant.WRITE_GRANT_OWNER,
        writeGrantedUsers: [normalUser._id],
      });
      expect(canEditPage({ user: normalUser, page })).toBe(true);
    });

    it('should return false when user is NOT in writeGrantedUsers', () => {
      const page = makePage({
        writeGrant: PageWriteGrant.WRITE_GRANT_OWNER,
        writeGrantedUsers: [otherUser._id],
      });
      expect(canEditPage({ user: normalUser, page })).toBe(false);
    });

    it('should return false when writeGrantedUsers is empty', () => {
      const page = makePage({
        writeGrant: PageWriteGrant.WRITE_GRANT_OWNER,
        writeGrantedUsers: [],
      });
      expect(canEditPage({ user: normalUser, page })).toBe(false);
    });
  });

  describe('WRITE_GRANT_USER_GROUP', () => {
    it('should return true when user belongs to a granted group', () => {
      const page = makePage({
        writeGrant: PageWriteGrant.WRITE_GRANT_USER_GROUP,
        writeGrantedGroups: [{ item: groupA }],
      });
      const userRelatedGroups = [{ item: { _id: groupA } }] as any;
      expect(canEditPage({ user: normalUser, page, userRelatedGroups })).toBe(
        true,
      );
    });

    it('should return false when user does NOT belong to any granted group', () => {
      const page = makePage({
        writeGrant: PageWriteGrant.WRITE_GRANT_USER_GROUP,
        writeGrantedGroups: [{ item: groupA }],
      });
      const userRelatedGroups = [{ item: { _id: groupB } }] as any;
      expect(canEditPage({ user: normalUser, page, userRelatedGroups })).toBe(
        false,
      );
    });

    it('should return false when user has no groups but groups are required', () => {
      const page = makePage({
        writeGrant: PageWriteGrant.WRITE_GRANT_USER_GROUP,
        writeGrantedGroups: [{ item: groupA }],
      });
      expect(
        canEditPage({ user: normalUser, page, userRelatedGroups: [] }),
      ).toBe(false);
    });

    it('should return true when user belongs to one of multiple granted groups', () => {
      const page = makePage({
        writeGrant: PageWriteGrant.WRITE_GRANT_USER_GROUP,
        writeGrantedGroups: [{ item: groupA }, { item: groupB }],
      });
      const userRelatedGroups = [{ item: { _id: groupB } }] as any;
      expect(canEditPage({ user: normalUser, page, userRelatedGroups })).toBe(
        true,
      );
    });
  });
});
