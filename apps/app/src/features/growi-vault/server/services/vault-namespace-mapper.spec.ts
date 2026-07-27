import type { IPage } from '@growi/core';
import { PageGrant, PageStatus } from '@growi/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createVaultNamespaceMapper,
  type VaultNamespaceMapper,
} from './vault-namespace-mapper';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock UserGroupRelation so tests do not require a MongoDB connection.
vi.mock('~/server/models/user-group-relation', () => ({
  default: {
    findAllUserGroupIdsRelatedToUser: vi.fn(),
  },
}));

// Mock ExternalUserGroupRelation for the same reason.
vi.mock(
  '~/features/external-user-group/server/models/external-user-group-relation',
  () => ({
    default: {
      findAllUserGroupIdsRelatedToUser: vi.fn(),
    },
  }),
);

// Mock the logger to suppress output during tests.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Lazy imports after mocks are registered
// ---------------------------------------------------------------------------

// We import the mocked modules after vi.mock() so we can call vi.mocked() on them.
const getUserGroupRelation = async () =>
  (await import('~/server/models/user-group-relation')).default;

const getExternalUserGroupRelation = async () =>
  (
    await import(
      '~/features/external-user-group/server/models/external-user-group-relation'
    )
  ).default;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal IPage stub for test cases.
 * All fields default to a published, public page at a normal path.
 */
const buildPage = (overrides: Partial<IPage> = {}): IPage => {
  return {
    path: '/some/page',
    status: PageStatus.STATUS_PUBLISHED,
    grant: PageGrant.GRANT_PUBLIC,
    grantedGroups: [],
    creator: undefined,
    tags: [],
    seenUsers: [],
    grantedUsers: [],
    liker: [],
    parent: null,
    descendantCount: 0,
    isEmpty: false,
    commentCount: 0,
    slackChannels: '',
    deleteUser: undefined as unknown as IPage['deleteUser'],
    deletedAt: undefined as unknown as IPage['deletedAt'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as IPage;
};

// ---------------------------------------------------------------------------
// Tests: computeAccessibleNamespaces
// ---------------------------------------------------------------------------

describe('VaultNamespaceMapper.computeAccessibleNamespaces', () => {
  let mapper: VaultNamespaceMapper;

  beforeEach(async () => {
    mapper = createVaultNamespaceMapper();
    vi.clearAllMocks();

    // Default: no groups for any user
    const ugr = await getUserGroupRelation();
    const eugr = await getExternalUserGroupRelation();
    vi.mocked(ugr.findAllUserGroupIdsRelatedToUser).mockResolvedValue([]);
    vi.mocked(eugr.findAllUserGroupIdsRelatedToUser).mockResolvedValue([]);
  });

  describe('anonymous user (userId === null)', () => {
    it('returns only ["public"]', async () => {
      const namespaces = await mapper.computeAccessibleNamespaces(null);
      expect(namespaces).toEqual(['public']);
    });

    it('does not call group relation models for anonymous users', async () => {
      await mapper.computeAccessibleNamespaces(null);

      const ugr = await getUserGroupRelation();
      const eugr = await getExternalUserGroupRelation();
      expect(ugr.findAllUserGroupIdsRelatedToUser).not.toHaveBeenCalled();
      expect(eugr.findAllUserGroupIdsRelatedToUser).not.toHaveBeenCalled();
    });

    it('accepts a scopes argument without changing the result (req 2.5 MVP)', async () => {
      // MVP: scopes are accepted but do not restrict anonymous access further
      const namespaces = await mapper.computeAccessibleNamespaces(null, [
        'read:features:page',
      ]);
      expect(namespaces).toEqual(['public']);
    });
  });

  describe('authenticated user with no group memberships', () => {
    it('returns public, restricted-link, and user-only-me namespace', async () => {
      const userId = 'user-abc-123';

      const namespaces = await mapper.computeAccessibleNamespaces(userId);

      expect(namespaces).toEqual([
        'public',
        'restricted-link',
        `user-${userId}-only-me`,
      ]);
    });

    it('returns the same namespaces when scopes are provided (req 2.5 MVP)', async () => {
      const userId = 'user-abc-123';

      // MVP: scopes are accepted but do not alter the namespace result for authenticated users
      const namespacesWithScopes = await mapper.computeAccessibleNamespaces(
        userId,
        ['read:features:page'],
      );
      const namespacesWithoutScopes =
        await mapper.computeAccessibleNamespaces(userId);

      expect(namespacesWithScopes).toEqual(namespacesWithoutScopes);
    });

    it('returns the same namespaces when an empty scopes array is provided', async () => {
      const userId = 'user-abc-456';

      const namespacesWithEmpty = await mapper.computeAccessibleNamespaces(
        userId,
        [],
      );
      const namespacesWithoutScopes =
        await mapper.computeAccessibleNamespaces(userId);

      expect(namespacesWithEmpty).toEqual(namespacesWithoutScopes);
    });
  });

  describe('authenticated user who belongs to one group', () => {
    it('includes the group namespace in the result', async () => {
      const userId = 'user-def-456';
      const groupId = 'group-id-001';

      const ugr = await getUserGroupRelation();
      vi.mocked(ugr.findAllUserGroupIdsRelatedToUser).mockResolvedValue([
        { toString: () => groupId } as never,
      ]);

      const namespaces = await mapper.computeAccessibleNamespaces(userId);

      expect(namespaces).toContain(`group-${groupId}`);
      expect(namespaces).toContain('public');
      expect(namespaces).toContain('restricted-link');
      expect(namespaces).toContain(`user-${userId}-only-me`);
    });
  });

  describe('authenticated user who belongs to multiple groups (internal + external)', () => {
    it('includes all group namespaces without duplicates', async () => {
      const userId = 'user-ghi-789';
      const internalGroupId = 'internal-grp-1';
      const externalGroupId = 'external-grp-2';

      const ugr = await getUserGroupRelation();
      const eugr = await getExternalUserGroupRelation();

      vi.mocked(ugr.findAllUserGroupIdsRelatedToUser).mockResolvedValue([
        { toString: () => internalGroupId } as never,
      ]);
      vi.mocked(eugr.findAllUserGroupIdsRelatedToUser).mockResolvedValue([
        { toString: () => externalGroupId } as never,
      ]);

      const namespaces = await mapper.computeAccessibleNamespaces(userId);

      expect(namespaces).toContain(`group-${internalGroupId}`);
      expect(namespaces).toContain(`group-${externalGroupId}`);
      // Ensure no duplicates
      expect(new Set(namespaces).size).toBe(namespaces.length);
    });

    it('deduplicates group IDs that appear in both internal and external relations', async () => {
      const userId = 'user-dup-000';
      const sharedGroupId = 'shared-group-id';

      const ugr = await getUserGroupRelation();
      const eugr = await getExternalUserGroupRelation();

      vi.mocked(ugr.findAllUserGroupIdsRelatedToUser).mockResolvedValue([
        { toString: () => sharedGroupId } as never,
      ]);
      vi.mocked(eugr.findAllUserGroupIdsRelatedToUser).mockResolvedValue([
        { toString: () => sharedGroupId } as never,
      ]);

      const namespaces = await mapper.computeAccessibleNamespaces(userId);
      const groupNamespace = `group-${sharedGroupId}`;

      expect(namespaces.filter((n) => n === groupNamespace)).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: computePageNamespaces
// ---------------------------------------------------------------------------

describe('VaultNamespaceMapper.computePageNamespaces', () => {
  let mapper: VaultNamespaceMapper;

  beforeEach(() => {
    mapper = createVaultNamespaceMapper();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GRANT_PUBLIC
  // -------------------------------------------------------------------------

  describe('GRANT_PUBLIC page', () => {
    it('returns { current: ["public"] }', () => {
      const page = buildPage({ grant: PageGrant.GRANT_PUBLIC });
      const result = mapper.computePageNamespaces(page);
      expect(result.current).toEqual(['public']);
      expect(result.previous).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // GRANT_RESTRICTED
  // -------------------------------------------------------------------------

  describe('GRANT_RESTRICTED page', () => {
    it('returns { current: ["restricted-link"] }', () => {
      const page = buildPage({ grant: PageGrant.GRANT_RESTRICTED });
      const result = mapper.computePageNamespaces(page);
      expect(result.current).toEqual(['restricted-link']);
    });
  });

  // -------------------------------------------------------------------------
  // GRANT_USER_GROUP
  // -------------------------------------------------------------------------

  describe('GRANT_USER_GROUP page with one group', () => {
    it('returns the single group namespace', () => {
      const groupId = 'abc-group-1';
      const page = buildPage({
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [
          { type: 'UserGroup', item: { toString: () => groupId } as never },
        ],
      });

      const result = mapper.computePageNamespaces(page);

      expect(result.current).toEqual([`group-${groupId}`]);
    });
  });

  describe('GRANT_USER_GROUP page with multiple groups', () => {
    it('returns one namespace per granted group (req 3.4)', () => {
      const groupId1 = 'grp-id-001';
      const groupId2 = 'grp-id-002';
      const page = buildPage({
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [
          { type: 'UserGroup', item: { toString: () => groupId1 } as never },
          {
            type: 'ExternalUserGroup',
            item: { toString: () => groupId2 } as never,
          },
        ],
      });

      const result = mapper.computePageNamespaces(page);

      expect(result.current).toEqual([
        `group-${groupId1}`,
        `group-${groupId2}`,
      ]);
    });
  });

  describe('GRANT_USER_GROUP page with empty grantedGroups', () => {
    it('returns an empty current array', () => {
      const page = buildPage({
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [],
      });
      const result = mapper.computePageNamespaces(page);
      expect(result.current).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // GRANT_OWNER
  // -------------------------------------------------------------------------

  describe('GRANT_OWNER page with a known creator', () => {
    it('returns the user-only-me namespace for the creator (req 3.5)', () => {
      const creatorId = 'creator-user-id-xyz';
      const page = buildPage({
        grant: PageGrant.GRANT_OWNER,
        creator: { toString: () => creatorId } as never,
      });

      const result = mapper.computePageNamespaces(page);

      expect(result.current).toEqual([`user-${creatorId}-only-me`]);
    });
  });

  describe('GRANT_OWNER page without a creator', () => {
    it('returns an empty current array when creator is undefined', () => {
      const page = buildPage({
        grant: PageGrant.GRANT_OWNER,
        creator: undefined,
      });
      const result = mapper.computePageNamespaces(page);
      expect(result.current).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // /trash pages — trash filter removed; apps/app is trash-agnostic (req 6.3)
  // -------------------------------------------------------------------------

  describe('page under /trash', () => {
    it('returns grant-derived namespace for trashed path (/trash/foo) — trash exclusion is vault-manager responsibility', () => {
      const page = buildPage({
        path: '/trash/foo',
        grant: PageGrant.GRANT_PUBLIC,
      });
      const result = mapper.computePageNamespaces(page);
      // apps/app layer must NOT filter out trash pages; vault-manager handles it via isExcludedFromVault()
      expect(result.current).toEqual(['public']);
    });

    it('returns grant-derived namespace for /trash itself', () => {
      const page = buildPage({
        path: '/trash',
        grant: PageGrant.GRANT_PUBLIC,
      });
      const result = mapper.computePageNamespaces(page);
      expect(result.current).toEqual(['public']);
    });
  });

  // -------------------------------------------------------------------------
  // Non-published pages — status filter removed; apps/app is status-agnostic (req 6.3)
  // -------------------------------------------------------------------------

  describe('non-published page', () => {
    it('returns grant-derived namespace for status !== published (e.g. deleted) — status exclusion is vault-manager responsibility', () => {
      const page = buildPage({
        status: PageStatus.STATUS_DELETED,
        grant: PageGrant.GRANT_PUBLIC,
      });
      const result = mapper.computePageNamespaces(page);
      // apps/app layer must NOT filter out non-published pages; vault-manager handles it
      expect(result.current).toEqual(['public']);
    });

    it('returns grant-derived namespace for unknown status values', () => {
      const page = buildPage({
        status: 'draft' as never,
        grant: PageGrant.GRANT_PUBLIC,
      });
      const result = mapper.computePageNamespaces(page);
      expect(result.current).toEqual(['public']);
    });
  });

  // -------------------------------------------------------------------------
  // Previous field (ACL change design)
  // -------------------------------------------------------------------------

  describe('previous field', () => {
    it('is undefined when computePageNamespaces is called without prior state', () => {
      const page = buildPage({ grant: PageGrant.GRANT_PUBLIC });
      const result = mapper.computePageNamespaces(page);
      expect(result.previous).toBeUndefined();
    });
  });
});
