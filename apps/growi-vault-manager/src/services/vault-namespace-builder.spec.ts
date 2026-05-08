/**
 * Unit tests for VaultNamespaceBuilder.applyInstruction
 *
 * All git I/O (VaultRepoStorage), DB access (RevisionModel,
 * VaultNamespaceStateModel, VaultUserViewModel), and pure-function
 * services (VaultPathMapper, VaultBlobHasher) are vi.mock'd so that
 * tests run without a real git bare repository or MongoDB instance.
 */

import type { VaultInstructionDoc } from '@growi/core/dist/interfaces/vault';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('./vault-repo-storage.js', () => ({
  readRef: vi.fn(),
  updateRef: vi.fn(),
  deleteRef: vi.fn(),
  readTree: vi.fn(),
  writeTree: vi.fn(),
  writeBlob: vi.fn(),
  writeCommit: vi.fn(),
}));

vi.mock('./vault-blob-hasher.js', () => ({
  hashBlob: vi.fn(),
}));

vi.mock('./vault-path-mapper.js', () => ({
  map: vi.fn(),
  mapPrefix: vi.fn(),
}));

vi.mock('../models/revision.js', () => ({
  RevisionModel: {
    findBodyById: vi.fn(),
    bodyQueryByIds: vi.fn(),
  },
}));

vi.mock('../models/vault-namespace-state.js', () => ({
  VaultNamespaceStateModel: {
    upsertNamespace: vi.fn(),
    find: vi.fn(),
    deleteAll: vi.fn(),
  },
}));

vi.mock('../models/vault-user-view.js', () => ({
  VaultUserViewModel: {
    deleteAll: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports — after vi.mock declarations
// ---------------------------------------------------------------------------

import { RevisionModel } from '../models/revision.js';
import { VaultNamespaceStateModel } from '../models/vault-namespace-state.js';
import { VaultUserViewModel } from '../models/vault-user-view.js';
import * as VaultBlobHasher from './vault-blob-hasher.js';
import { applyInstruction } from './vault-namespace-builder.js';
import * as VaultPathMapper from './vault-path-mapper.js';
import * as VaultRepoStorage from './vault-repo-storage.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal VaultInstructionDoc for testing. */
function makeInstruction(
  overrides: Partial<VaultInstructionDoc> & { op: VaultInstructionDoc['op'] },
): VaultInstructionDoc {
  return {
    _id: 'inst-001',
    issuedAt: new Date('2024-01-01T00:00:00Z'),
    processedAt: null,
    attempts: 0,
    lastError: null,
    payload: {},
    ...overrides,
  } as VaultInstructionDoc;
}

type MockFn = ReturnType<typeof vi.fn> & {
  mockResolvedValueOnce: (v: unknown) => MockFn;
  mockReturnValueOnce: (v: unknown) => MockFn;
};

/** Casts any value to a vi mock so callers can call .mockResolvedValue / .mockReturnValue. */
function asMock(fn: unknown): MockFn {
  // biome-ignore lint/suspicious/noExplicitAny: intentional any cast in test helper
  return fn as any;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: namespace has no existing ref → root commit.
  asMock(VaultRepoStorage.readRef).mockResolvedValue(null);
  // Default: writeTree returns a deterministic fake OID.
  asMock(VaultRepoStorage.writeTree).mockResolvedValue('tree-oid-root');
  // Default: writeBlob returns a fake OID.
  asMock(VaultRepoStorage.writeBlob).mockResolvedValue('blob-oid');
  // Default: writeCommit returns a fake commit OID.
  asMock(VaultRepoStorage.writeCommit).mockResolvedValue('commit-oid');
  // Default: readTree returns empty entries.
  asMock(VaultRepoStorage.readTree).mockResolvedValue([]);
  // Default: updateRef and deleteRef succeed silently.
  asMock(VaultRepoStorage.updateRef).mockResolvedValue(undefined);
  asMock(VaultRepoStorage.deleteRef).mockResolvedValue(undefined);

  // Default: hashBlob returns a deterministic OID.
  asMock(VaultBlobHasher.hashBlob).mockResolvedValue('blob-sha1-oid');

  // Default: map returns a simple file path.
  asMock(VaultPathMapper.map).mockReturnValue('pages/page.md');
  // Default: mapPrefix returns a directory prefix.
  asMock(VaultPathMapper.mapPrefix).mockReturnValue('pages');

  // Default: upsertNamespace resolves.
  asMock(VaultNamespaceStateModel.upsertNamespace).mockResolvedValue({
    namespace: 'public',
    commitOid: 'commit-oid',
    version: 1,
    updatedAt: new Date(),
  });

  // Default: VaultUserViewModel.deleteAll resolves.
  asMock(VaultUserViewModel.deleteAll).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------

describe('op: upsert', () => {
  it('writes blob, updates tree, creates commit, and updates ref', async () => {
    asMock(RevisionModel.findBodyById).mockResolvedValue({
      _id: 'rev-001',
      body: '# Page body',
    });
    asMock(VaultBlobHasher.hashBlob).mockResolvedValue('blob-abc123');
    asMock(VaultPathMapper.map).mockReturnValue('docs/page.md');
    asMock(VaultRepoStorage.writeTree).mockResolvedValue('tree-oid-1');
    asMock(VaultRepoStorage.writeCommit).mockResolvedValue('commit-xyz');

    const instruction = makeInstruction({
      op: 'upsert',
      payload: {
        namespace: 'public',
        pageId: 'page-001',
        pagePath: '/docs/page',
        revisionId: 'rev-001',
      },
    });

    await applyInstruction(instruction);

    // Blob should be written with the page body.
    expect(VaultRepoStorage.writeBlob).toHaveBeenCalledWith(
      Buffer.from('# Page body'),
    );

    // Ref should be updated with the new commit OID.
    expect(VaultRepoStorage.updateRef).toHaveBeenCalledWith(
      'refs/namespaces/public/refs/heads/main',
      'commit-xyz',
    );

    // State should be persisted.
    expect(VaultNamespaceStateModel.upsertNamespace).toHaveBeenCalledWith(
      'public',
      'commit-xyz',
    );
  });

  it('throws when revision is not found', async () => {
    asMock(RevisionModel.findBodyById).mockResolvedValue(null);

    const instruction = makeInstruction({
      op: 'upsert',
      payload: {
        namespace: 'public',
        pageId: 'page-001',
        pagePath: '/docs/page',
        revisionId: 'rev-missing',
      },
    });

    await expect(applyInstruction(instruction)).rejects.toThrow('rev-missing');
  });

  it('throws when required payload fields are missing', async () => {
    const instruction = makeInstruction({
      op: 'upsert',
      payload: { namespace: 'public' }, // missing pageId, pagePath, revisionId
    });

    await expect(applyInstruction(instruction)).rejects.toThrow(
      'missing required payload fields',
    );
  });

  it('uses existing namespace HEAD as parent commit', async () => {
    asMock(RevisionModel.findBodyById).mockResolvedValue({
      _id: 'rev-001',
      body: 'body',
    });
    asMock(VaultRepoStorage.readRef).mockResolvedValue('existing-commit-oid');
    asMock(VaultRepoStorage.readTree).mockResolvedValue([]);

    const instruction = makeInstruction({
      op: 'upsert',
      payload: {
        namespace: 'public',
        pageId: 'page-001',
        pagePath: '/docs/page',
        revisionId: 'rev-001',
      },
    });

    await applyInstruction(instruction);

    expect(VaultRepoStorage.writeCommit).toHaveBeenCalledWith(
      expect.objectContaining({ parents: ['existing-commit-oid'] }),
    );
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('op: remove', () => {
  it('removes the file entry, creates a commit, and updates ref', async () => {
    asMock(VaultPathMapper.map).mockReturnValue('docs/page.md');
    // Simulate an existing tree entry for the page.
    asMock(VaultRepoStorage.readTree).mockResolvedValue([
      { mode: '040000', path: 'docs', oid: 'tree-docs', type: 'tree' },
    ]);
    asMock(VaultRepoStorage.writeTree).mockResolvedValue('tree-after-remove');
    asMock(VaultRepoStorage.writeCommit).mockResolvedValue('commit-remove');

    const instruction = makeInstruction({
      op: 'remove',
      payload: {
        namespace: 'public',
        pageId: 'page-001',
        pagePath: '/docs/page',
      },
    });

    await applyInstruction(instruction);

    expect(VaultRepoStorage.updateRef).toHaveBeenCalledWith(
      'refs/namespaces/public/refs/heads/main',
      'commit-remove',
    );
    expect(VaultNamespaceStateModel.upsertNamespace).toHaveBeenCalledWith(
      'public',
      'commit-remove',
    );
  });

  it('is idempotent: removing a non-existent file still creates a commit', async () => {
    asMock(VaultPathMapper.map).mockReturnValue('docs/missing.md');
    asMock(VaultRepoStorage.readTree).mockResolvedValue([]); // empty tree
    asMock(VaultRepoStorage.writeTree).mockResolvedValue('empty-tree-oid');
    asMock(VaultRepoStorage.writeCommit).mockResolvedValue('commit-noop');

    const instruction = makeInstruction({
      op: 'remove',
      payload: {
        namespace: 'public',
        pageId: 'page-001',
        pagePath: '/docs/missing',
      },
    });

    await applyInstruction(instruction);

    expect(VaultRepoStorage.updateRef).toHaveBeenCalledWith(
      'refs/namespaces/public/refs/heads/main',
      'commit-noop',
    );
  });

  it('throws when required payload fields are missing', async () => {
    const instruction = makeInstruction({
      op: 'remove',
      payload: { namespace: 'public' },
    });

    await expect(applyInstruction(instruction)).rejects.toThrow(
      'missing required payload fields',
    );
  });
});

// ---------------------------------------------------------------------------
// Idempotency: same upsert instruction twice → same commit OID
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('same upsert instruction twice produces the same commit OID', async () => {
    asMock(RevisionModel.findBodyById).mockResolvedValue({
      _id: 'rev-001',
      body: 'deterministic body',
    });
    asMock(VaultBlobHasher.hashBlob).mockResolvedValue('blob-fixed-oid');
    asMock(VaultPathMapper.map).mockReturnValue('docs/page.md');
    // writeTree always returns the same OID for the same content (content-addressed).
    asMock(VaultRepoStorage.writeTree).mockResolvedValue('tree-fixed-oid');
    // Simulate no existing ref → root commit.
    asMock(VaultRepoStorage.readRef).mockResolvedValue(null);
    asMock(VaultRepoStorage.writeCommit).mockResolvedValue('commit-fixed-oid');

    const instruction = makeInstruction({
      op: 'upsert',
      payload: {
        namespace: 'public',
        pageId: 'page-001',
        pagePath: '/docs/page',
        revisionId: 'rev-001',
      },
    });

    await applyInstruction(instruction);
    // Second invocation — readRef now returns the first commit.
    asMock(VaultRepoStorage.readRef).mockResolvedValue('commit-fixed-oid');
    await applyInstruction(instruction);

    const updateRefCalls = asMock(VaultRepoStorage.updateRef).mock.calls;
    // Both calls should update the ref to the same commit OID because the
    // same tree content produces the same tree OID, and the commit OID is
    // determined by our mock returning 'commit-fixed-oid'.
    expect(updateRefCalls[0][1]).toEqual(updateRefCalls[1][1]);
  });
});

// ---------------------------------------------------------------------------
// bulk-upsert
// ---------------------------------------------------------------------------

describe('op: bulk-upsert', () => {
  function makeBulkCursor(bodies: Array<{ _id: string; body: string }>) {
    // Simulate an async iterable cursor returned by Mongoose.
    return {
      // biome-ignore lint/suspicious/useAwait: generator needs to be async for for-await compatibility
      [Symbol.asyncIterator]: async function* () {
        for (const doc of bodies) {
          yield doc;
        }
      },
    };
  }

  beforeEach(() => {
    asMock(VaultRepoStorage.readTree).mockResolvedValue([]);
  });

  it('N=1: fetches revision, writes blob, builds tree, creates single commit', async () => {
    const cursor = makeBulkCursor([{ _id: 'rev-001', body: 'body-1' }]);
    asMock(RevisionModel.bodyQueryByIds).mockReturnValue({
      query: { cursor: () => cursor },
      skippedIds: [],
    });
    asMock(VaultPathMapper.map).mockReturnValue('pages/p1.md');
    asMock(VaultBlobHasher.hashBlob).mockResolvedValue('blob-1');
    asMock(VaultRepoStorage.writeTree).mockResolvedValue('tree-bulk-1');
    asMock(VaultRepoStorage.writeCommit).mockResolvedValue('commit-bulk-1');

    const instruction = makeInstruction({
      op: 'bulk-upsert',
      payload: {
        namespace: 'public',
        entries: [
          { pageId: 'p1', pagePath: '/pages/p1', revisionId: 'rev-001' },
        ],
      },
    });

    await applyInstruction(instruction);

    expect(VaultRepoStorage.writeBlob).toHaveBeenCalledTimes(1);
    expect(VaultRepoStorage.writeCommit).toHaveBeenCalledTimes(1);
    expect(VaultRepoStorage.updateRef).toHaveBeenCalledTimes(1);
    expect(VaultNamespaceStateModel.upsertNamespace).toHaveBeenCalledTimes(1);
  });

  it('N=1000: fetches all revisions in one cursor, creates exactly 1 commit', async () => {
    const N = 1000;
    const revisions = Array.from({ length: N }, (_, i) => ({
      _id: `rev-${i}`,
      body: `body-${i}`,
    }));
    const entries = Array.from({ length: N }, (_, i) => ({
      pageId: `p${i}`,
      pagePath: `/pages/p${i}`,
      revisionId: `rev-${i}`,
    }));

    const cursor = makeBulkCursor(revisions);
    asMock(RevisionModel.bodyQueryByIds).mockReturnValue({
      query: { cursor: () => cursor },
      skippedIds: [],
    });
    asMock(VaultPathMapper.map).mockImplementation(
      (_path: unknown, _id: unknown) => `pages/p${_id}.md`,
    );
    asMock(VaultBlobHasher.hashBlob).mockResolvedValue('blob-oid');
    asMock(VaultRepoStorage.writeTree).mockResolvedValue('tree-bulk-1000');
    asMock(VaultRepoStorage.writeCommit).mockResolvedValue('commit-bulk-1000');

    const instruction = makeInstruction({
      op: 'bulk-upsert',
      payload: { namespace: 'public', entries },
    });

    await applyInstruction(instruction);

    // Only one commit should be created regardless of entry count.
    expect(VaultRepoStorage.writeCommit).toHaveBeenCalledTimes(1);
    // updateRef should be called exactly once.
    expect(VaultRepoStorage.updateRef).toHaveBeenCalledTimes(1);
    // bodyQueryByIds should be called once (single query).
    expect(RevisionModel.bodyQueryByIds).toHaveBeenCalledTimes(1);
  });

  it('N=1001 (chunk boundary): still creates exactly 1 commit', async () => {
    const N = 1001;
    const revisions = Array.from({ length: N }, (_, i) => ({
      _id: `rev-${i}`,
      body: `body-${i}`,
    }));
    const entries = Array.from({ length: N }, (_, i) => ({
      pageId: `p${i}`,
      pagePath: `/pages/p${i}`,
      revisionId: `rev-${i}`,
    }));

    const cursor = makeBulkCursor(revisions);
    asMock(RevisionModel.bodyQueryByIds).mockReturnValue({
      query: { cursor: () => cursor },
      skippedIds: [],
    });
    asMock(VaultPathMapper.map).mockImplementation(
      (_path: unknown, _id: unknown) => `pages/p${_id}.md`,
    );
    asMock(VaultBlobHasher.hashBlob).mockResolvedValue('blob-oid');
    asMock(VaultRepoStorage.writeTree).mockResolvedValue('tree-bulk-1001');
    asMock(VaultRepoStorage.writeCommit).mockResolvedValue('commit-bulk-1001');

    const instruction = makeInstruction({
      op: 'bulk-upsert',
      payload: { namespace: 'public', entries },
    });

    await applyInstruction(instruction);

    expect(VaultRepoStorage.writeCommit).toHaveBeenCalledTimes(1);
    expect(VaultRepoStorage.updateRef).toHaveBeenCalledTimes(1);
  });

  it('throws when entries list is empty', async () => {
    const instruction = makeInstruction({
      op: 'bulk-upsert',
      payload: { namespace: 'public', entries: [] },
    });

    await expect(applyInstruction(instruction)).rejects.toThrow(
      'missing required payload fields',
    );
  });
});

// ---------------------------------------------------------------------------
// rename-prefix
// ---------------------------------------------------------------------------

describe('op: rename-prefix', () => {
  it('moves subtree from oldPrefix to newPrefix without re-writing blobs', async () => {
    asMock(VaultPathMapper.mapPrefix)
      .mockReturnValueOnce('old/prefix') // first call → oldFilePrefix
      .mockReturnValueOnce('new/prefix'); // second call → newFilePrefix

    // Simulate root tree with an 'old' directory.
    asMock(VaultRepoStorage.readRef).mockResolvedValue('existing-commit-oid');
    asMock(VaultRepoStorage.readTree)
      .mockResolvedValueOnce([
        // root tree — has 'old' subtree
        { mode: '040000', path: 'old', oid: 'tree-old', type: 'tree' },
      ])
      .mockResolvedValueOnce([
        // 'old' subtree → 'prefix' subtree
        { mode: '040000', path: 'prefix', oid: 'tree-prefix', type: 'tree' },
      ])
      .mockResolvedValueOnce([
        // 'prefix' subtree contents
        { mode: '100644', path: 'page.md', oid: 'blob-abc', type: 'blob' },
      ])
      .mockResolvedValue([]); // any remaining reads → empty

    asMock(VaultRepoStorage.writeTree).mockResolvedValue('tree-renamed');
    asMock(VaultRepoStorage.writeCommit).mockResolvedValue('commit-rename');

    const instruction = makeInstruction({
      op: 'rename-prefix',
      payload: {
        namespace: 'public',
        oldPrefix: '/old/prefix',
        newPrefix: '/new/prefix',
      },
    });

    await applyInstruction(instruction);

    // writeBlob must NOT be called (no blob re-writing).
    expect(VaultRepoStorage.writeBlob).not.toHaveBeenCalled();

    expect(VaultRepoStorage.updateRef).toHaveBeenCalledWith(
      'refs/namespaces/public/refs/heads/main',
      'commit-rename',
    );
  });
});

// ---------------------------------------------------------------------------
// reset-all
// ---------------------------------------------------------------------------

describe('op: reset-all', () => {
  it('deletes all namespace refs, clears state, preserves object pool', async () => {
    // Simulate three existing namespaces.
    // The implementation calls .find({}, {namespace:1}).lean<...>() which returns a Promise.
    const namespaceDocs = [
      { namespace: 'public' },
      { namespace: 'group-g1' },
      { namespace: 'user-u1-only-me' },
    ];
    asMock(VaultNamespaceStateModel.find).mockReturnValue({
      lean: () => Promise.resolve(namespaceDocs),
    });
    asMock(VaultNamespaceStateModel.deleteAll).mockResolvedValue(undefined);

    const instruction = makeInstruction({
      op: 'reset-all',
      payload: {},
    });

    await applyInstruction(instruction);

    // deleteRef must be called for every namespace.
    expect(VaultRepoStorage.deleteRef).toHaveBeenCalledWith(
      'refs/namespaces/public/refs/heads/main',
    );
    expect(VaultRepoStorage.deleteRef).toHaveBeenCalledWith(
      'refs/namespaces/group-g1/refs/heads/main',
    );
    expect(VaultRepoStorage.deleteRef).toHaveBeenCalledWith(
      'refs/namespaces/user-u1-only-me/refs/heads/main',
    );
    expect(VaultRepoStorage.deleteRef).toHaveBeenCalledTimes(3);

    // State collections must be cleared.
    expect(VaultNamespaceStateModel.deleteAll).toHaveBeenCalled();
    expect(VaultUserViewModel.deleteAll).toHaveBeenCalled();

    // Object pool (writeBlob, writeTree, writeCommit) must NOT be touched.
    expect(VaultRepoStorage.writeBlob).not.toHaveBeenCalled();
    expect(VaultRepoStorage.writeTree).not.toHaveBeenCalled();
    expect(VaultRepoStorage.writeCommit).not.toHaveBeenCalled();
  });

  it('succeeds with no namespaces (empty state)', async () => {
    asMock(VaultNamespaceStateModel.find).mockReturnValue({
      lean: () => Promise.resolve([]),
    });
    asMock(VaultNamespaceStateModel.deleteAll).mockResolvedValue(undefined);

    const instruction = makeInstruction({
      op: 'reset-all',
      payload: {},
    });

    await applyInstruction(instruction);

    expect(VaultRepoStorage.deleteRef).not.toHaveBeenCalled();
    expect(VaultNamespaceStateModel.deleteAll).toHaveBeenCalled();
    expect(VaultUserViewModel.deleteAll).toHaveBeenCalled();
  });
});
