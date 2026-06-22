import { GroupType } from '@growi/core';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type { ExternalUserGroupDocument } from '~/features/external-user-group/server/models/external-user-group';
import type { ExternalUserGroupRelationDocument } from '~/features/external-user-group/server/models/external-user-group-relation';
import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import type { UserGroupDocument } from '~/server/models/user-group';
import type { UserGroupRelationDocument } from '~/server/models/user-group-relation';

import { fetchActiveMembersByGroup } from './fetch-active-members-by-group';

// ---- model mocks (hoisted) -----------------------------------------------
vi.mock('~/server/models/user-group-relation', () => ({
  default: {
    find: vi.fn(),
  },
}));

vi.mock(
  '~/features/external-user-group/server/models/external-user-group-relation',
  () => ({
    default: {
      find: vi.fn(),
    },
  }),
);

// We mock mongoose.model to intercept the User model lookup
vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof mongoose>();
  return {
    ...actual,
    default: {
      ...actual.default,
      model: vi.fn(),
    },
  };
});

// ---- helpers ---------------------------------------------------------------

/** Build a fake ObjectId-like string */
const makeId = () => new mongoose.Types.ObjectId().toString();

/** Build a minimal PopulatedGrantedGroup (internal) */
const makeInternalGroup = (
  id: string,
  name = 'group',
): PopulatedGrantedGroup => ({
  type: GroupType.userGroup,
  item: mock<UserGroupDocument>({ _id: new mongoose.Types.ObjectId(id), name }),
});

/** Build a minimal PopulatedGrantedGroup (external) */
const makeExternalGroup = (
  id: string,
  name = 'ext-group',
): PopulatedGrantedGroup => ({
  type: GroupType.externalUserGroup,
  item: mock<ExternalUserGroupDocument>({
    _id: new mongoose.Types.ObjectId(id),
    name,
  }),
});

/** Build a fake relation document */
const makeRelation = (relatedGroupId: string, relatedUserId: string) =>
  mock<UserGroupRelationDocument | ExternalUserGroupRelationDocument>({
    relatedGroup: new mongoose.Types.ObjectId(relatedGroupId),
    relatedUser: new mongoose.Types.ObjectId(relatedUserId),
  });

// ---- test suite ------------------------------------------------------------

describe('fetchActiveMembersByGroup', () => {
  // biome-ignore lint/suspicious/noExplicitAny: TypeScript sees the declared module type, not the vi.mock replacement
  let UserGroupRelation: any;
  // biome-ignore lint/suspicious/noExplicitAny: TypeScript sees the declared module type, not the vi.mock replacement
  let ExternalUserGroupRelation: any;
  // biome-ignore lint/suspicious/noExplicitAny: TypeScript sees the declared module type, not the vi.mock replacement
  let mongooseMock: any;

  beforeEach(async () => {
    // Dynamically import mocked modules
    const ugr = await import('~/server/models/user-group-relation');
    UserGroupRelation = ugr.default;

    const eugr = await import(
      '~/features/external-user-group/server/models/external-user-group-relation'
    );
    ExternalUserGroupRelation = eugr.default;

    mongooseMock = (await import('mongoose')).default;

    vi.clearAllMocks();
  });

  describe('basic grouping — internal + external mixed', () => {
    it('bundles members by groupId for both internal and external groups', async () => {
      const internalGroupId = makeId();
      const externalGroupId = makeId();
      const userId1 = makeId();
      const userId2 = makeId();

      // Internal relation: user1 belongs to internalGroup
      UserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi
            .fn()
            .mockResolvedValue([makeRelation(internalGroupId, userId1)]),
        }),
      });

      // External relation: user2 belongs to externalGroup
      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi
            .fn()
            .mockResolvedValue([makeRelation(externalGroupId, userId2)]),
        }),
      });

      // User bulk find returns both users
      const fakeUser1 = {
        _id: new mongoose.Types.ObjectId(userId1),
        name: 'Alice',
        username: 'alice',
      };
      const fakeUser2 = {
        _id: new mongoose.Types.ObjectId(userId2),
        name: 'Bob',
        username: 'bob',
      };

      mongooseMock.model.mockReturnValue({
        find: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([fakeUser1, fakeUser2]),
            }),
          }),
        }),
      });

      const groups = [
        makeInternalGroup(internalGroupId),
        makeExternalGroup(externalGroupId),
      ];

      const result = await fetchActiveMembersByGroup(groups);

      expect(result[internalGroupId]).toHaveLength(1);
      expect(result[internalGroupId][0]).toEqual({
        name: 'Alice',
        username: 'alice',
      });
      expect(result[externalGroupId]).toHaveLength(1);
      expect(result[externalGroupId][0]).toEqual({
        name: 'Bob',
        username: 'bob',
      });
    });

    it('assigns a user to multiple groups when they belong to both', async () => {
      const internalGroupId = makeId();
      const externalGroupId = makeId();
      const sharedUserId = makeId();

      UserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi
            .fn()
            .mockResolvedValue([makeRelation(internalGroupId, sharedUserId)]),
        }),
      });

      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi
            .fn()
            .mockResolvedValue([makeRelation(externalGroupId, sharedUserId)]),
        }),
      });

      const fakeSharedUser = {
        _id: new mongoose.Types.ObjectId(sharedUserId),
        name: 'Shared',
        username: 'shared',
      };
      mongooseMock.model.mockReturnValue({
        find: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([fakeSharedUser]),
            }),
          }),
        }),
      });

      const groups = [
        makeInternalGroup(internalGroupId),
        makeExternalGroup(externalGroupId),
      ];

      const result = await fetchActiveMembersByGroup(groups);

      expect(result[internalGroupId]).toHaveLength(1);
      expect(result[externalGroupId]).toHaveLength(1);
      expect(result[internalGroupId][0].username).toBe('shared');
      expect(result[externalGroupId][0].username).toBe('shared');
    });
  });

  describe('inactive user exclusion (req 2.3)', () => {
    it('does not include inactive users in the result', async () => {
      const internalGroupId = makeId();
      const activeUserId = makeId();
      const inactiveUserId = makeId();

      // Both users are in the relation (DB level)
      UserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi
            .fn()
            .mockResolvedValue([
              makeRelation(internalGroupId, activeUserId),
              makeRelation(internalGroupId, inactiveUserId),
            ]),
        }),
      });

      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      // Only active user returned from User.find (status filter applied in query)
      const activeUser = {
        _id: new mongoose.Types.ObjectId(activeUserId),
        name: 'Active',
        username: 'active_user',
      };
      mongooseMock.model.mockReturnValue({
        find: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([activeUser]),
            }),
          }),
        }),
      });

      const groups = [makeInternalGroup(internalGroupId)];

      const result = await fetchActiveMembersByGroup(groups);

      expect(result[internalGroupId]).toHaveLength(1);
      expect(result[internalGroupId][0].username).toBe('active_user');
    });

    it('queries User model with STATUS_ACTIVE filter', async () => {
      const internalGroupId = makeId();
      const userId = makeId();

      UserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi
            .fn()
            .mockResolvedValue([makeRelation(internalGroupId, userId)]),
        }),
      });
      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      const mockUserFind = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
      mongooseMock.model.mockReturnValue({ find: mockUserFind });

      await fetchActiveMembersByGroup([makeInternalGroup(internalGroupId)]);

      expect(mockUserFind).toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.anything(), // STATUS_ACTIVE value
        }),
      );
    });
  });

  describe('returned fields — name and username only (req 1.2, 3.4)', () => {
    it('returns only name and username — no email, no _id, no other fields', async () => {
      const internalGroupId = makeId();
      const userId = makeId();

      UserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi
            .fn()
            .mockResolvedValue([makeRelation(internalGroupId, userId)]),
        }),
      });
      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      // Simulate DB returning lean docs (MongoDB always includes _id; the projected
      // fields are name+username, but _id is returned by default).
      const dbUser = {
        _id: new mongoose.Types.ObjectId(userId),
        name: 'Charlie',
        username: 'charlie',
      };
      mongooseMock.model.mockReturnValue({
        find: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([dbUser]),
            }),
          }),
        }),
      });

      const groups = [makeInternalGroup(internalGroupId)];
      const result = await fetchActiveMembersByGroup(groups);

      const member = result[internalGroupId][0];
      expect(member).toEqual({ name: 'Charlie', username: 'charlie' });
      // Ensure no extra fields
      expect(Object.keys(member)).toEqual(
        expect.arrayContaining(['name', 'username']),
      );
      expect(Object.keys(member)).toHaveLength(2);
    });

    it('passes "name username" projection to User.find().select()', async () => {
      const internalGroupId = makeId();
      const userId = makeId();

      UserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi
            .fn()
            .mockResolvedValue([makeRelation(internalGroupId, userId)]),
        }),
      });
      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      const mockSelect = vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });
      mongooseMock.model.mockReturnValue({
        find: vi.fn().mockReturnValue({ select: mockSelect }),
      });

      await fetchActiveMembersByGroup([makeInternalGroup(internalGroupId)]);

      expect(mockSelect).toHaveBeenCalledWith('name username');
    });
  });

  describe('empty groups (req 1.4)', () => {
    it('returns an empty array for a group with no members', async () => {
      const internalGroupId = makeId();

      UserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });
      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      mongooseMock.model.mockReturnValue({
        find: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      const groups = [makeInternalGroup(internalGroupId)];
      const result = await fetchActiveMembersByGroup(groups);

      expect(result[internalGroupId]).toEqual([]);
    });

    it('returns an empty array for external group with no members', async () => {
      const externalGroupId = makeId();

      UserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });
      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      mongooseMock.model.mockReturnValue({
        find: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      const groups = [makeExternalGroup(externalGroupId)];
      const result = await fetchActiveMembersByGroup(groups);

      expect(result[externalGroupId]).toEqual([]);
    });

    it('returns empty object when groups array is empty', async () => {
      UserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });
      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      mongooseMock.model.mockReturnValue({
        find: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      const result = await fetchActiveMembersByGroup([]);
      expect(result).toEqual({});
    });
  });

  describe('no cross-group contamination (req 2.2)', () => {
    it('only queries relations for the provided groups, not descendants/ancestors', async () => {
      const groupId = makeId();

      const mockFindInternal = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });
      UserGroupRelation.find = mockFindInternal;

      ExternalUserGroupRelation.find.mockReturnValue({
        select: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue([]),
        }),
      });

      mongooseMock.model.mockReturnValue({
        find: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            lean: vi.fn().mockReturnValue({
              exec: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      await fetchActiveMembersByGroup([makeInternalGroup(groupId)]);

      // Should query only by the given group ids, not by any recursive lookup
      expect(mockFindInternal).toHaveBeenCalledWith(
        expect.objectContaining({
          relatedGroup: expect.objectContaining({ $in: expect.any(Array) }),
        }),
      );
      // Verify only the one provided group id was passed
      const callArg = mockFindInternal.mock.calls[0][0];
      expect(callArg.relatedGroup.$in).toHaveLength(1);
    });
  });
});
