/**
 * Unit tests for VaultTreeNormalizer (vault-tree-normalizer.ts)
 *
 * The normalizer is a pure function operating on recursive tree nodes.
 * No external dependencies — no mocks required.
 *
 * Test scenarios:
 *   1. No collision — tree is returned unchanged (no suffix added)
 *   2. Blob collision — two blobs in the same directory whose names are
 *      case-insensitively equal both receive a __<hash8> suffix
 *   3. Subtree collision — two subtrees with case-insensitively equal names
 *      both receive a __<hash8> suffix
 *   4. Collision resolved (1 member remaining) — suffix is removed
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { normalizeTree, type TreeNode } from './vault-tree-normalizer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Computes the expected hash8 suffix component for a given full path. */
function hash8(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 8);
}

/** Constructs a blob TreeNode with the given name and optional oid. */
function blobNode(
  name: string,
  oid = 'aaa0000000000000000000000000000000000000',
): TreeNode {
  return {
    entry: {
      mode: '100644',
      path: name,
      oid,
      type: 'blob',
    },
  };
}

/** Constructs a tree TreeNode with the given name and children. */
function treeNode(
  name: string,
  children: ReadonlyArray<TreeNode> = [],
  oid = 'bbb0000000000000000000000000000000000000',
): TreeNode {
  return {
    entry: {
      mode: '040000',
      path: name,
      oid,
      type: 'tree',
    },
    children,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeTree', () => {
  /**
   * Scenario 1: No collision
   * All entries have case-insensitively unique names → no suffix is added.
   */
  it('returns the tree unchanged when there are no case-insensitive collisions', () => {
    const nodes: ReadonlyArray<TreeNode> = [
      blobNode('Alpha.md'),
      blobNode('beta.md'),
      treeNode('Gamma', [blobNode('inner.md')]),
    ];

    const result = normalizeTree(nodes);

    expect(result).toHaveLength(3);
    expect(result[0].entry.path).toBe('Alpha.md');
    expect(result[1].entry.path).toBe('beta.md');
    expect(result[2].entry.path).toBe('Gamma');
    // Children should also be unmodified
    expect(result[2].children).toHaveLength(1);
    expect(result[2].children?.[0].entry.path).toBe('inner.md');
  });

  /**
   * Scenario 2: Blob collision at root level
   * 'MyPage.md' and 'mypage.md' are case-insensitively equal → both get
   * __<hash8> suffix inserted before the extension.
   */
  it('applies __<hash8> suffix to both blobs when their names collide case-insensitively', () => {
    const nodes: ReadonlyArray<TreeNode> = [
      blobNode('MyPage.md'),
      blobNode('mypage.md'),
    ];

    const result = normalizeTree(nodes);

    expect(result).toHaveLength(2);

    const expectedHash0 = hash8('MyPage.md');
    const expectedHash1 = hash8('mypage.md');

    expect(result[0].entry.path).toBe(`MyPage__${expectedHash0}.md`);
    expect(result[1].entry.path).toBe(`mypage__${expectedHash1}.md`);

    // Original entry metadata (mode, oid, type) must be preserved
    expect(result[0].entry.mode).toBe('100644');
    expect(result[0].entry.type).toBe('blob');
    expect(result[1].entry.mode).toBe('100644');
    expect(result[1].entry.type).toBe('blob');
  });

  /**
   * Scenario 3: Subtree collision
   * Directories 'Docs' and 'docs' collide case-insensitively → both directory
   * entries get __<hash8> appended to their names.
   * The parentPath is propagated correctly for child full-path computation.
   */
  it('applies __<hash8> suffix to both subtrees when their names collide case-insensitively', () => {
    const nodes: ReadonlyArray<TreeNode> = [
      treeNode('Docs', [blobNode('api.md')]),
      treeNode('docs', [blobNode('guide.md')]),
    ];

    const result = normalizeTree(nodes, '');

    expect(result).toHaveLength(2);

    const expectedHash0 = hash8('Docs');
    const expectedHash1 = hash8('docs');

    expect(result[0].entry.path).toBe(`Docs__${expectedHash0}`);
    expect(result[1].entry.path).toBe(`docs__${expectedHash1}`);

    // type and mode preserved
    expect(result[0].entry.type).toBe('tree');
    expect(result[1].entry.type).toBe('tree');

    // Children should still be present and unmodified (no collision within children)
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children?.[0].entry.path).toBe('api.md');
    expect(result[1].children).toHaveLength(1);
    expect(result[1].children?.[0].entry.path).toBe('guide.md');
  });

  /**
   * Scenario 4: Collision resolved — member count drops to 1
   * When only one member remains in a collision group, its suffix is removed
   * (reactive suffix removal). No persistent state is required — the
   * normalizer derives this purely from the current tree structure.
   */
  it('removes the suffix when a previously-colliding group is reduced to a single member', () => {
    // Only one entry remains — no collision partner → no suffix.
    const nodes: ReadonlyArray<TreeNode> = [blobNode('mypage.md')];

    const result = normalizeTree(nodes);

    expect(result).toHaveLength(1);
    // No suffix because the group has only 1 member
    expect(result[0].entry.path).toBe('mypage.md');
  });

  /**
   * Scenario 4b: Nested collision with resolved parent-level path
   * Validates that when a subtree collides, the full path used for hashing
   * at the child level includes the parent directory's original name (before
   * any suffix was applied to the parent).
   */
  it('uses the pre-suffix full path for hash computation in nested collisions', () => {
    // Two blobs at the same level inside a subtree, with a parent path
    const nodes: ReadonlyArray<TreeNode> = [
      blobNode('README.md'),
      blobNode('readme.md'),
    ];
    const parentPath = 'docs/api';

    const result = normalizeTree(nodes, parentPath);

    const fullPath0 = 'docs/api/README.md';
    const fullPath1 = 'docs/api/readme.md';
    const expectedHash0 = hash8(fullPath0);
    const expectedHash1 = hash8(fullPath1);

    expect(result[0].entry.path).toBe(`README__${expectedHash0}.md`);
    expect(result[1].entry.path).toBe(`readme__${expectedHash1}.md`);
  });

  /**
   * Scenario: Mixed blob + subtree collision
   * A blob named 'foo.md' does NOT collide with a subtree named 'foo' — they
   * differ after lowercasing (their names include extensions or lack them).
   * However, a blob 'Foo.md' and a blob 'foo.md' DO collide.
   * And a subtree 'Foo' and a subtree 'foo' DO collide.
   * A blob 'Foo.md' and a subtree 'Foo' do NOT collide (different names).
   */
  it('does not apply suffix to entries that have no case-insensitive name collision', () => {
    const nodes: ReadonlyArray<TreeNode> = [
      blobNode('unique.md'),
      treeNode('Unique'), // 'unique.md' vs 'unique' — lowercase differs → no collision
    ];

    const result = normalizeTree(nodes);

    // 'unique.md'.toLowerCase() = 'unique.md'
    // 'Unique'.toLowerCase()    = 'unique'
    // These differ → no collision → no suffix
    expect(result[0].entry.path).toBe('unique.md');
    expect(result[1].entry.path).toBe('Unique');
  });

  /**
   * Scenario: Blob without extension collision
   * 'MyPage' and 'mypage' collide — suffix appended to the whole name.
   */
  it('appends suffix to the whole name for blobs without extension', () => {
    const nodes: ReadonlyArray<TreeNode> = [
      blobNode('MyPage'),
      blobNode('mypage'),
    ];

    const result = normalizeTree(nodes);

    const expectedHash0 = hash8('MyPage');
    const expectedHash1 = hash8('mypage');

    expect(result[0].entry.path).toBe(`MyPage__${expectedHash0}`);
    expect(result[1].entry.path).toBe(`mypage__${expectedHash1}`);
  });

  /**
   * Scenario: Three-way collision
   * Three blobs with the same case-insensitive name — all three get distinct
   * suffixes (since their full paths differ).
   */
  it('applies distinct suffixes to all members of a three-way collision group', () => {
    const nodes: ReadonlyArray<TreeNode> = [
      blobNode('Page.md'),
      blobNode('page.md'),
      blobNode('PAGE.md'),
    ];

    const result = normalizeTree(nodes);

    const h0 = hash8('Page.md');
    const h1 = hash8('page.md');
    const h2 = hash8('PAGE.md');

    expect(result[0].entry.path).toBe(`Page__${h0}.md`);
    expect(result[1].entry.path).toBe(`page__${h1}.md`);
    expect(result[2].entry.path).toBe(`PAGE__${h2}.md`);

    // All hashes must be distinct (since the paths differ)
    expect(new Set([h0, h1, h2]).size).toBe(3);
  });
});
