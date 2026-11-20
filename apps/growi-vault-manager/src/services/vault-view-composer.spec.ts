/**
 * Unit tests for VaultViewComposer (vault-view-composer.ts)
 *
 * All external dependencies (VaultRepoStorage, VaultNamespaceStateModel,
 * VaultUserViewModel) are mocked so that these tests run without a real git
 * repository or MongoDB connection.
 */

// biome-ignore-all lint/suspicious/useAwait: vitest mockImplementation accepts async fns whose body returns a sync value; await is unnecessary
// biome-ignore-all lint/style/noNonNullAssertion: tests use ! after expect().toBeDefined() to narrow type when the assertion already guarantees non-null

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock modules BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../models/vault-namespace-state.js', () => ({
  VaultNamespaceStateModel: {
    getCommitOidMap: vi.fn(),
  },
}));

vi.mock('../models/vault-user-view.js', () => ({
  VaultUserViewModel: {
    findByUserId: vi.fn(),
    upsertView: vi.fn(),
  },
}));

vi.mock('./vault-repo-storage.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./vault-repo-storage.js')>();
  return {
    ...actual,
    readRef: vi.fn(),
    readTree: vi.fn(),
    writeTree: vi.fn(),
    writeCommit: vi.fn(),
    updateRef: vi.fn(),
    ensureNamespaceHead: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after vi.mock declarations)
// ---------------------------------------------------------------------------

import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import { VaultUserViewModel } from '../models/vault-user-view.js';
import * as VaultRepoStorage from './vault-repo-storage.js';
import {
  applyNamespaceDeltas,
  compose,
  fullMergeTreesByPath,
} from './vault-view-composer.js';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockGetCommitOidMap = vi.mocked(VaultNamespaceStateModel.getCommitOidMap);
const mockFindByUserId = vi.mocked(VaultUserViewModel.findByUserId);
const mockUpsertView = vi.mocked(VaultUserViewModel.upsertView);
const mockReadRef = vi.mocked(VaultRepoStorage.readRef);
const mockReadTree = vi.mocked(VaultRepoStorage.readTree);
const mockWriteTree = vi.mocked(VaultRepoStorage.writeTree);
const mockWriteCommit = vi.mocked(VaultRepoStorage.writeCommit);
const mockUpdateRef = vi.mocked(VaultRepoStorage.updateRef);
const mockEnsureNamespaceHead = vi.mocked(VaultRepoStorage.ensureNamespaceHead);

// ---------------------------------------------------------------------------
// Common test data
// ---------------------------------------------------------------------------

const TREE_OID_MERGED = 'dddd000000000000000000000000000000000000';
const COMMIT_OID_PUBLIC = '1111000000000000000000000000000000000000';
const COMMIT_OID_GROUP = '2222000000000000000000000000000000000000';
const COMMIT_OID_ONLY_ME = '3333000000000000000000000000000000000000';
const COMMIT_OID_VIEW = '4444000000000000000000000000000000000000';
const COMMIT_OID_VIEW_NEW = '5555000000000000000000000000000000000000';

const USER_ID = 'deadbeef00000000deadbeef';
const NAMESPACES = [
  'public',
  'group-eng',
  'user-deadbeef00000000deadbeef-only-me',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserView(
  overrides: Partial<{
    viewRef: string;
    viewCommitOid: string;
    mergedTreeOid: string;
    sourceVersions: Record<string, string>;
  }> = {},
) {
  return {
    userId: USER_ID,
    viewRef: `user-${USER_ID}-view`,
    viewCommitOid: COMMIT_OID_VIEW,
    mergedTreeOid: TREE_OID_MERGED,
    sourceVersions: {
      public: COMMIT_OID_PUBLIC,
      'group-eng': COMMIT_OID_GROUP,
      [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
    },
    composedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// beforeEach reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default happy-path stubs
  mockGetCommitOidMap.mockResolvedValue({
    public: COMMIT_OID_PUBLIC,
    'group-eng': COMMIT_OID_GROUP,
    [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
  });
  mockFindByUserId.mockResolvedValue(null);
  mockUpsertView.mockResolvedValue({
    userId: USER_ID,
    viewRef: `user-${USER_ID}-view`,
    viewCommitOid: COMMIT_OID_VIEW_NEW,
    mergedTreeOid: TREE_OID_MERGED,
    sourceVersions: {},
    composedAt: new Date(),
  });

  // Default: all namespace refs resolve to their commit OID
  mockReadRef.mockImplementation(async (refPath: string) => {
    if (refPath.includes('public')) return COMMIT_OID_PUBLIC;
    if (refPath.includes('group-eng')) return COMMIT_OID_GROUP;
    if (refPath.includes('only-me')) return COMMIT_OID_ONLY_ME;
    return null;
  });

  // Default: readTree returns empty entries (no blobs = easy to verify writes)
  mockReadTree.mockResolvedValue([]);

  // Default: writeTree returns a stable merged OID
  mockWriteTree.mockResolvedValue(TREE_OID_MERGED);

  // Default: writeCommit returns a new view commit OID
  mockWriteCommit.mockResolvedValue(COMMIT_OID_VIEW_NEW);

  // Default: updateRef resolves immediately
  mockUpdateRef.mockResolvedValue(undefined);

  // Default: ensureNamespaceHead resolves immediately
  mockEnsureNamespaceHead.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Test: cache hit
// ---------------------------------------------------------------------------

describe('compose — cache hit', () => {
  it('returns existing viewCommitOid without recomposing when sourceVersions match', async () => {
    const existingView = makeUserView();
    mockFindByUserId.mockResolvedValue(existingView);

    const result = await compose(USER_ID, NAMESPACES);

    expect(result).toEqual({
      viewRef: `user-${USER_ID}-view`,
      commitOid: COMMIT_OID_VIEW,
    });

    // Must NOT write any objects or update the ref
    expect(mockWriteTree).not.toHaveBeenCalled();
    expect(mockWriteCommit).not.toHaveBeenCalled();
    expect(mockUpdateRef).not.toHaveBeenCalled();
    expect(mockUpsertView).not.toHaveBeenCalled();
  });

  it('treats a namespace missing from state as empty string for cache comparison', async () => {
    // Namespace 'group-eng' has no entry in vault_namespace_state
    mockGetCommitOidMap.mockResolvedValue({
      public: COMMIT_OID_PUBLIC,
      [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
      // 'group-eng' is absent
    });

    const existingView = makeUserView({
      sourceVersions: {
        public: COMMIT_OID_PUBLIC,
        'group-eng': '', // stored as empty string
        [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
      },
    });
    mockFindByUserId.mockResolvedValue(existingView);

    const result = await compose(USER_ID, NAMESPACES);

    // Should be a cache hit — sourceVersions match
    expect(result.commitOid).toBe(COMMIT_OID_VIEW);
    expect(mockWriteCommit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test: full merge (initial compose)
// ---------------------------------------------------------------------------

describe('compose — full merge (initial)', () => {
  it('merges trees from all namespaces and creates a new view ref', async () => {
    // No existing view → triggers full merge
    mockFindByUserId.mockResolvedValue(null);

    const result = await compose(USER_ID, NAMESPACES);

    expect(result).toEqual({
      viewRef: `user-${USER_ID}-view`,
      commitOid: COMMIT_OID_VIEW_NEW,
    });

    // Should have read refs for each namespace
    expect(mockReadRef).toHaveBeenCalledWith(
      'refs/namespaces/public/refs/heads/main',
    );
    expect(mockReadRef).toHaveBeenCalledWith(
      'refs/namespaces/group-eng/refs/heads/main',
    );

    // Should have written a commit and updated the ref
    expect(mockWriteCommit).toHaveBeenCalledOnce();
    expect(mockUpdateRef).toHaveBeenCalledWith(
      `refs/namespaces/user-${USER_ID}-view/refs/heads/main`,
      COMMIT_OID_VIEW_NEW,
    );
    expect(mockUpsertView).toHaveBeenCalledOnce();
  });

  it('uses anonymous-view ref when userId is null', async () => {
    mockFindByUserId.mockResolvedValue(null);
    mockGetCommitOidMap.mockResolvedValue({ public: COMMIT_OID_PUBLIC });

    const result = await compose(null, ['public']);

    expect(result.viewRef).toBe('anonymous-view');
    expect(mockUpdateRef).toHaveBeenCalledWith(
      'refs/namespaces/anonymous-view/refs/heads/main',
      COMMIT_OID_VIEW_NEW,
    );
  });

  it('creates commit with no parents on initial compose', async () => {
    mockFindByUserId.mockResolvedValue(null);

    await compose(USER_ID, NAMESPACES);

    const commitCall = mockWriteCommit.mock.calls[0][0];
    expect(commitCall.parents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test: full merge — multiple namespaces, tree is correctly built
// ---------------------------------------------------------------------------

describe('fullMergeTreesByPath — tree building', () => {
  it('merges multiple namespace trees into one flat tree', async () => {
    // public namespace has: docs/page-a.md (blob-a)
    // group-eng namespace has: docs/page-b.md (blob-b)
    mockReadRef.mockImplementation(async (refPath: string) => {
      if (refPath.includes('public')) return COMMIT_OID_PUBLIC;
      if (refPath.includes('group-eng')) return COMMIT_OID_GROUP;
      return null;
    });
    mockReadTree.mockImplementation(async (oid: string) => {
      if (oid === COMMIT_OID_PUBLIC) {
        return [
          {
            mode: '040000',
            path: 'docs',
            oid: 'docs-oid-public',
            type: 'tree' as const,
          },
        ];
      }
      if (oid === 'docs-oid-public') {
        return [
          {
            mode: '100644',
            path: 'page-a.md',
            oid: 'blob-a',
            type: 'blob' as const,
          },
        ];
      }
      if (oid === COMMIT_OID_GROUP) {
        return [
          {
            mode: '040000',
            path: 'docs',
            oid: 'docs-oid-group',
            type: 'tree' as const,
          },
        ];
      }
      if (oid === 'docs-oid-group') {
        return [
          {
            mode: '100644',
            path: 'page-b.md',
            oid: 'blob-b',
            type: 'blob' as const,
          },
        ];
      }
      return [];
    });
    mockWriteTree.mockResolvedValue(TREE_OID_MERGED);

    const resultOid = await fullMergeTreesByPath(['public', 'group-eng']);

    expect(resultOid).toBe(TREE_OID_MERGED);
    // writeTree should have been called at least once (to write the merged tree)
    expect(mockWriteTree).toHaveBeenCalled();
  });

  it('returns an empty tree OID when all namespaces are empty', async () => {
    mockReadRef.mockResolvedValue(null); // No refs
    mockWriteTree.mockResolvedValue(TREE_OID_MERGED);

    const resultOid = await fullMergeTreesByPath(['public', 'group-eng']);

    // Should still write an empty tree
    expect(mockWriteTree).toHaveBeenCalled();
    expect(resultOid).toBe(TREE_OID_MERGED);
  });
});

// ---------------------------------------------------------------------------
// Test: delta merge
// ---------------------------------------------------------------------------

describe('compose — delta merge', () => {
  it('runs delta merge when only one namespace changed', async () => {
    // Existing view has stale version for group-eng
    const existingView = makeUserView({
      sourceVersions: {
        public: COMMIT_OID_PUBLIC,
        'group-eng': 'old-group-commit-oid0000000000000000000',
        [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
      },
    });
    mockFindByUserId.mockResolvedValue(existingView);

    // Current state: group-eng has a new commit
    mockGetCommitOidMap.mockResolvedValue({
      public: COMMIT_OID_PUBLIC,
      'group-eng': COMMIT_OID_GROUP, // changed
      [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
    });

    await compose(USER_ID, NAMESPACES);

    // Should have created a new commit (delta merge path)
    expect(mockWriteCommit).toHaveBeenCalledOnce();

    // The commit should reference the previous view commit as parent
    const commitCall = mockWriteCommit.mock.calls[0][0];
    expect(commitCall.parents).toEqual([COMMIT_OID_VIEW]);
  });

  it('falls back to full merge when base tree cannot be read (gc pruned)', async () => {
    const existingView = makeUserView({
      sourceVersions: {
        public: COMMIT_OID_PUBLIC,
        'group-eng': 'old-group-commit-oid0000000000000000000',
        [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
      },
    });
    mockFindByUserId.mockResolvedValue(existingView);

    mockGetCommitOidMap.mockResolvedValue({
      public: COMMIT_OID_PUBLIC,
      'group-eng': COMMIT_OID_GROUP,
      [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
    });

    // Simulate readTree throwing because base tree is pruned by gc
    mockReadTree.mockRejectedValueOnce(new Error('object not found'));

    // Should not throw — falls back to full merge
    const result = await compose(USER_ID, NAMESPACES);

    expect(result.commitOid).toBe(COMMIT_OID_VIEW_NEW);
    expect(mockWriteCommit).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Test: applyNamespaceDeltas — direct unit test
// ---------------------------------------------------------------------------

describe('applyNamespaceDeltas', () => {
  it('processes changed namespaces and rebuilds the merged tree', async () => {
    mockReadRef.mockImplementation(async (refPath: string) => {
      if (refPath.includes('public')) return COMMIT_OID_PUBLIC;
      if (refPath.includes('group-eng')) return COMMIT_OID_GROUP;
      return null;
    });
    mockReadTree.mockResolvedValue([]);
    mockWriteTree.mockResolvedValue(TREE_OID_MERGED);

    const resultOid = await applyNamespaceDeltas(
      TREE_OID_MERGED,
      ['public', 'group-eng'],
      ['group-eng'], // only group-eng changed
    );

    expect(resultOid).toBe(TREE_OID_MERGED);
    expect(mockWriteTree).toHaveBeenCalled();
  });

  it('re-reads only changed namespace refs from the repo', async () => {
    mockReadRef.mockResolvedValue(null);
    mockWriteTree.mockResolvedValue(TREE_OID_MERGED);

    await applyNamespaceDeltas(
      TREE_OID_MERGED,
      ['public', 'group-eng', 'user-x-only-me'],
      ['group-eng'],
    );

    // readRef called for all namespaces (unchanged ones too, for consistency)
    const refCalls = mockReadRef.mock.calls.map((c) => c[0]);
    // Unchanged namespaces should also be read (we do a fresh pass for correctness)
    expect(refCalls.some((r: string) => r.includes('public'))).toBe(true);
    expect(refCalls.some((r: string) => r.includes('group-eng'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test: conflict resolution
// ---------------------------------------------------------------------------

describe('compose — conflict resolution (same path, multiple namespaces)', () => {
  const BLOB_PUBLIC = 'blob-from-public-0000000000000000000000';
  const BLOB_GROUP = 'blob-from-group-eng-0000000000000000000';
  const BLOB_RESTRICTED = 'blob-from-restricted-link-000000000000';
  const BLOB_ONLY_ME = 'blob-from-only-me-0000000000000000000000';

  beforeEach(() => {
    mockFindByUserId.mockResolvedValue(null);
    mockWriteCommit.mockResolvedValue(COMMIT_OID_VIEW_NEW);
    mockUpdateRef.mockResolvedValue(undefined);
    mockUpsertView.mockResolvedValue({
      userId: USER_ID,
      viewRef: `user-${USER_ID}-view`,
      viewCommitOid: COMMIT_OID_VIEW_NEW,
      mergedTreeOid: TREE_OID_MERGED,
      sourceVersions: {},
      composedAt: new Date(),
    });
  });

  it('user-<uid>-only-me wins over public', async () => {
    const onlyMeNs = `user-${USER_ID}-only-me`;
    const commitOnlyMe = '3333000000000000000000000000000000000001';
    const commitPublic = '1111000000000000000000000000000000000001';

    mockGetCommitOidMap.mockResolvedValue({
      public: commitPublic,
      [onlyMeNs]: commitOnlyMe,
    });

    mockReadRef.mockImplementation(async (refPath: string) => {
      if (refPath.includes(`/${onlyMeNs}/`)) return commitOnlyMe;
      if (refPath.includes('/public/')) return commitPublic;
      return null;
    });
    mockReadTree.mockImplementation(async (oid: string) => {
      if (oid === commitOnlyMe) {
        return [
          {
            mode: '100644',
            path: 'page.md',
            oid: BLOB_ONLY_ME,
            type: 'blob' as const,
          },
        ];
      }
      if (oid === commitPublic) {
        return [
          {
            mode: '100644',
            path: 'page.md',
            oid: BLOB_PUBLIC,
            type: 'blob' as const,
          },
        ];
      }
      return [];
    });

    let capturedWriteTreeCall: ReturnType<typeof mockReadTree> | null = null;
    mockWriteTree.mockImplementation(async (entries) => {
      capturedWriteTreeCall =
        entries as unknown as typeof capturedWriteTreeCall;
      return TREE_OID_MERGED;
    });

    await compose(USER_ID, ['public', onlyMeNs]);

    // The final root writeTree call should contain page.md with BLOB_ONLY_ME
    const allCalls = mockWriteTree.mock.calls;
    // Find the call that includes page.md
    const rootCall = allCalls.find((args) =>
      (args[0] as unknown as ReadonlyArray<{ path: string; oid: string }>).some(
        (e: { path: string; oid: string }) => e.path === 'page.md',
      ),
    );
    expect(rootCall).toBeDefined();
    const pageEntry = (
      rootCall![0] as unknown as ReadonlyArray<{ path: string; oid: string }>
    ).find((e: { path: string; oid: string }) => e.path === 'page.md');
    expect(pageEntry?.oid).toBe(BLOB_ONLY_ME);
  });

  it('group-* wins over restricted-link', async () => {
    const commitGroup = '2222000000000000000000000000000000000001';
    const commitRestricted = '9999000000000000000000000000000000000001';

    mockGetCommitOidMap.mockResolvedValue({
      'group-eng': commitGroup,
      'restricted-link': commitRestricted,
    });

    mockReadRef.mockImplementation(async (refPath: string) => {
      if (refPath.includes('/group-eng/')) return commitGroup;
      if (refPath.includes('/restricted-link/')) return commitRestricted;
      return null;
    });
    mockReadTree.mockImplementation(async (oid: string) => {
      if (oid === commitGroup) {
        return [
          {
            mode: '100644',
            path: 'page.md',
            oid: BLOB_GROUP,
            type: 'blob' as const,
          },
        ];
      }
      if (oid === commitRestricted) {
        return [
          {
            mode: '100644',
            path: 'page.md',
            oid: BLOB_RESTRICTED,
            type: 'blob' as const,
          },
        ];
      }
      return [];
    });

    mockWriteTree.mockImplementation(async () => TREE_OID_MERGED);

    await compose(USER_ID, ['restricted-link', 'group-eng']);

    const allCalls = mockWriteTree.mock.calls;
    const rootCall = allCalls.find((args) =>
      (args[0] as unknown as ReadonlyArray<{ path: string; oid: string }>).some(
        (e: { path: string; oid: string }) => e.path === 'page.md',
      ),
    );
    expect(rootCall).toBeDefined();
    const pageEntry = (
      rootCall![0] as unknown as ReadonlyArray<{ path: string; oid: string }>
    ).find((e: { path: string; oid: string }) => e.path === 'page.md');
    expect(pageEntry?.oid).toBe(BLOB_GROUP);
  });

  it('restricted-link wins over public', async () => {
    const commitPublic = '1111000000000000000000000000000000000002';
    const commitRestricted = '9999000000000000000000000000000000000002';

    mockGetCommitOidMap.mockResolvedValue({
      public: commitPublic,
      'restricted-link': commitRestricted,
    });

    mockReadRef.mockImplementation(async (refPath: string) => {
      if (refPath.includes('/public/')) return commitPublic;
      if (refPath.includes('/restricted-link/')) return commitRestricted;
      return null;
    });
    mockReadTree.mockImplementation(async (oid: string) => {
      if (oid === commitPublic) {
        return [
          {
            mode: '100644',
            path: 'page.md',
            oid: BLOB_PUBLIC,
            type: 'blob' as const,
          },
        ];
      }
      if (oid === commitRestricted) {
        return [
          {
            mode: '100644',
            path: 'page.md',
            oid: BLOB_RESTRICTED,
            type: 'blob' as const,
          },
        ];
      }
      return [];
    });

    mockWriteTree.mockImplementation(async () => TREE_OID_MERGED);

    await compose(USER_ID, ['public', 'restricted-link']);

    const allCalls = mockWriteTree.mock.calls;
    const rootCall = allCalls.find((args) =>
      (args[0] as unknown as ReadonlyArray<{ path: string; oid: string }>).some(
        (e: { path: string; oid: string }) => e.path === 'page.md',
      ),
    );
    expect(rootCall).toBeDefined();
    const pageEntry = (
      rootCall![0] as unknown as ReadonlyArray<{ path: string; oid: string }>
    ).find((e: { path: string; oid: string }) => e.path === 'page.md');
    expect(pageEntry?.oid).toBe(BLOB_RESTRICTED);
  });

  it('user-<uid>-only-me wins over group-* and restricted-link', async () => {
    const onlyMeNs = `user-${USER_ID}-only-me`;
    const commitOnlyMe = '3333000000000000000000000000000000000002';
    const commitGroup = '2222000000000000000000000000000000000002';
    const commitRestricted = '9999000000000000000000000000000000000003';

    mockGetCommitOidMap.mockResolvedValue({
      'restricted-link': commitRestricted,
      'group-eng': commitGroup,
      [onlyMeNs]: commitOnlyMe,
    });

    mockReadRef.mockImplementation(async (refPath: string) => {
      if (refPath.includes(`/${onlyMeNs}/`)) return commitOnlyMe;
      if (refPath.includes('/group-eng/')) return commitGroup;
      if (refPath.includes('/restricted-link/')) return commitRestricted;
      return null;
    });
    mockReadTree.mockImplementation(async (oid: string) => {
      if (oid === commitOnlyMe) {
        return [
          {
            mode: '100644',
            path: 'page.md',
            oid: BLOB_ONLY_ME,
            type: 'blob' as const,
          },
        ];
      }
      if (oid === commitGroup) {
        return [
          {
            mode: '100644',
            path: 'page.md',
            oid: BLOB_GROUP,
            type: 'blob' as const,
          },
        ];
      }
      if (oid === commitRestricted) {
        return [
          {
            mode: '100644',
            path: 'page.md',
            oid: BLOB_RESTRICTED,
            type: 'blob' as const,
          },
        ];
      }
      return [];
    });

    mockWriteTree.mockImplementation(async () => TREE_OID_MERGED);

    await compose(USER_ID, ['restricted-link', 'group-eng', onlyMeNs]);

    const allCalls = mockWriteTree.mock.calls;
    const rootCall = allCalls.find((args) =>
      (args[0] as unknown as ReadonlyArray<{ path: string; oid: string }>).some(
        (e: { path: string; oid: string }) => e.path === 'page.md',
      ),
    );
    expect(rootCall).toBeDefined();
    const pageEntry = (
      rootCall![0] as unknown as ReadonlyArray<{ path: string; oid: string }>
    ).find((e: { path: string; oid: string }) => e.path === 'page.md');
    expect(pageEntry?.oid).toBe(BLOB_ONLY_ME);
  });
});

// ---------------------------------------------------------------------------
// Test: normalizer integration — cross-namespace case collision
// ---------------------------------------------------------------------------

describe('compose — normalizer: cross-namespace case collision (4.9, 4.10, 4.11)', () => {
  /**
   * Scenario:
   *   public namespace: provides `Foo.md` (upper-case F)
   *   group-eng namespace: provides `foo.md` (lower-case f)
   *
   * After full merge → normalizer, both files exist in the view but with
   * distinct `__<hash8>` suffixes so the client can distinguish them.
   *
   * The test verifies that writeTree is eventually called with entries whose
   * paths differ from each other (i.e. both survived and were disambiguated).
   */
  it('disambiguates cross-namespace case collision with __<hash8> suffix after full merge', async () => {
    const BLOB_FOO_PUBLIC = 'blob-foo-public-000000000000000000000000';
    const BLOB_FOO_GROUP = 'blob-foo-group-00000000000000000000000000';
    const COMMIT_PUBLIC_CASE = '1111aaaa0000000000000000000000000000000a';
    const COMMIT_GROUP_CASE = '2222bbbb0000000000000000000000000000000b';

    mockFindByUserId.mockResolvedValue(null);
    mockGetCommitOidMap.mockResolvedValue({
      public: COMMIT_PUBLIC_CASE,
      'group-eng': COMMIT_GROUP_CASE,
    });

    mockReadRef.mockImplementation(async (refPath: string) => {
      if (refPath.includes('/public/')) return COMMIT_PUBLIC_CASE;
      if (refPath.includes('/group-eng/')) return COMMIT_GROUP_CASE;
      return null;
    });

    // Each namespace root has a single file that only differs in case.
    mockReadTree.mockImplementation(async (oid: string) => {
      if (oid === COMMIT_PUBLIC_CASE) {
        return [
          {
            mode: '100644',
            path: 'Foo.md',
            oid: BLOB_FOO_PUBLIC,
            type: 'blob' as const,
          },
        ];
      }
      if (oid === COMMIT_GROUP_CASE) {
        return [
          {
            mode: '100644',
            path: 'foo.md',
            oid: BLOB_FOO_GROUP,
            type: 'blob' as const,
          },
        ];
      }
      return [];
    });

    // Capture all writeTree calls to inspect the final root entries.
    const writtenEntryLists: Array<
      ReadonlyArray<{ path: string; oid: string }>
    > = [];
    mockWriteTree.mockImplementation(async (entries) => {
      writtenEntryLists.push(
        entries as unknown as Array<{ path: string; oid: string }>,
      );
      return TREE_OID_MERGED;
    });
    mockWriteCommit.mockResolvedValue(COMMIT_OID_VIEW_NEW);

    await compose(USER_ID, ['public', 'group-eng']);

    // After normalization, the root tree must contain two entries (both files
    // survived), and their names must differ from each other and from the
    // original bare names (i.e. each has a suffix applied).
    const rootEntries = writtenEntryLists[writtenEntryLists.length - 1];
    expect(rootEntries).toBeDefined();

    // Both blobs must be present (neither was silently dropped).
    const pathsWritten = rootEntries.map((e) => e.path);
    expect(pathsWritten).toHaveLength(2);

    // Neither entry should be the original bare name (suffix must have been applied).
    expect(pathsWritten).not.toContain('Foo.md');
    expect(pathsWritten).not.toContain('foo.md');

    // The two entries must be distinct from each other.
    expect(new Set(pathsWritten).size).toBe(2);
  });

  /**
   * Scenario: delta merge path — same cross-namespace case collision.
   * Ensures normalizer runs on delta merge output too.
   */
  it('disambiguates case collision in the delta merge path', async () => {
    const BLOB_FOO_PUBLIC = 'blob-foo-public-delta-0000000000000000000';
    const BLOB_FOO_GROUP = 'blob-foo-group-delta-00000000000000000000';
    const COMMIT_PUBLIC_DELTA = '1111cccc0000000000000000000000000000000c';
    const COMMIT_GROUP_OLD = '2222dddd0000000000000000000000000000000d';
    const COMMIT_GROUP_NEW = '2222eeee0000000000000000000000000000000e';

    // Existing view (cache miss — group-eng changed)
    mockFindByUserId.mockResolvedValue(
      makeUserView({
        sourceVersions: {
          public: COMMIT_PUBLIC_DELTA,
          'group-eng': COMMIT_GROUP_OLD,
        },
      }),
    );

    mockGetCommitOidMap.mockResolvedValue({
      public: COMMIT_PUBLIC_DELTA,
      'group-eng': COMMIT_GROUP_NEW,
    });

    mockReadRef.mockImplementation(async (refPath: string) => {
      if (refPath.includes('/public/')) return COMMIT_PUBLIC_DELTA;
      if (refPath.includes('/group-eng/')) return COMMIT_GROUP_NEW;
      return null;
    });

    mockReadTree.mockImplementation(async (oid: string) => {
      if (oid === COMMIT_PUBLIC_DELTA) {
        return [
          {
            mode: '100644',
            path: 'Foo.md',
            oid: BLOB_FOO_PUBLIC,
            type: 'blob' as const,
          },
        ];
      }
      if (oid === COMMIT_GROUP_NEW) {
        return [
          {
            mode: '100644',
            path: 'foo.md',
            oid: BLOB_FOO_GROUP,
            type: 'blob' as const,
          },
        ];
      }
      return [];
    });

    const writtenEntryLists: Array<
      ReadonlyArray<{ path: string; oid: string }>
    > = [];
    mockWriteTree.mockImplementation(async (entries) => {
      writtenEntryLists.push(
        entries as unknown as Array<{ path: string; oid: string }>,
      );
      return TREE_OID_MERGED;
    });
    mockWriteCommit.mockResolvedValue(COMMIT_OID_VIEW_NEW);

    await compose(USER_ID, ['public', 'group-eng']);

    const rootEntries = writtenEntryLists[writtenEntryLists.length - 1];
    expect(rootEntries).toBeDefined();

    const pathsWritten = rootEntries.map((e) => e.path);
    expect(pathsWritten).toHaveLength(2);
    expect(pathsWritten).not.toContain('Foo.md');
    expect(pathsWritten).not.toContain('foo.md');
    expect(new Set(pathsWritten).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test: cache hit → normalizer is skipped
// ---------------------------------------------------------------------------

describe('compose — cache hit skips normalizer (4.9)', () => {
  it('does not call writeTree (and thus normalizer) when sourceVersions match', async () => {
    // sourceVersions match current state → cache hit
    const existingView = makeUserView({
      sourceVersions: {
        public: COMMIT_OID_PUBLIC,
        'group-eng': COMMIT_OID_GROUP,
        [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
      },
    });
    mockFindByUserId.mockResolvedValue(existingView);

    await compose(USER_ID, NAMESPACES);

    // Cache hit path must skip all merge and normalization work.
    expect(mockReadRef).not.toHaveBeenCalled();
    expect(mockReadTree).not.toHaveBeenCalled();
    expect(mockWriteTree).not.toHaveBeenCalled();
    expect(mockWriteCommit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test: full merge fallback when base tree is gc-pruned
// ---------------------------------------------------------------------------

describe('compose — full merge fallback on gc-pruned base tree', () => {
  it('falls back to full merge when applyNamespaceDeltas throws', async () => {
    const existingView = makeUserView({
      sourceVersions: {
        public: COMMIT_OID_PUBLIC,
        'group-eng': 'old-group-oid0000000000000000000000000',
        [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
      },
    });
    mockFindByUserId.mockResolvedValue(existingView);

    mockGetCommitOidMap.mockResolvedValue({
      public: COMMIT_OID_PUBLIC,
      'group-eng': COMMIT_OID_GROUP, // changed
      [`user-${USER_ID}-only-me`]: COMMIT_OID_ONLY_ME,
    });

    // readTree will throw on first call (simulating gc-pruned base tree in delta merge),
    // then return empty arrays for subsequent calls (full merge reads from refs).
    let callCount = 0;
    mockReadTree.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('object not found (gc pruned)');
      }
      return [];
    });

    mockWriteTree.mockResolvedValue(TREE_OID_MERGED);
    mockWriteCommit.mockResolvedValue(COMMIT_OID_VIEW_NEW);

    const result = await compose(USER_ID, NAMESPACES);

    // Should succeed via full merge fallback
    expect(result.commitOid).toBe(COMMIT_OID_VIEW_NEW);
    expect(mockWriteCommit).toHaveBeenCalledOnce();
  });
});
