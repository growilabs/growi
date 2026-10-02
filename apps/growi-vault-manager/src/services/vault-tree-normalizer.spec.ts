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
 *   5. Byte-length budget — names that would exceed the 255-byte filesystem
 *      limit are shortened so a client can check the tree out
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

/** UTF-8 byte length — the unit filesystems impose their limit in. */
function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Splits a normalized entry name into the part kept from the original name and
 * the `__<hash8>` suffix. The regex is greedy so it anchors on the *last*
 * suffix-shaped substring, which keeps it correct for original names that
 * themselves contain '__'.
 */
function splitNormalizedName(name: string): { kept: string; hash: string } {
  const match = /^(.*)__([0-9a-f]{8})(\.md)?$/.exec(name);
  if (match == null) {
    throw new Error(`'${name}' does not carry a __<hash8> suffix`);
  }
  return { kept: match[1], hash: match[2] };
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

  /**
   * Byte-length budget (issue #11596).
   *
   * ext4 / APFS reject a path component longer than 255 bytes, and
   * `git checkout` aborts the whole operation on the first rejected file — so a
   * single over-long page name makes the entire clone unusable. The normalizer
   * therefore shortens such names, reusing the same `__<hash8>` suffix it uses
   * for case collisions to keep distinct pages distinct.
   *
   * The contract asserted here is what a client experiences after checkout:
   * every name fits in 255 bytes, is still valid UTF-8, keeps its `.md`
   * extension, and stays unique — while names that already fit are byte-for-byte
   * untouched so existing clones see no churn.
   */
  describe('byte-length budget', () => {
    /** The per-component limit on ext4 / APFS, measured in UTF-8 bytes. */
    const MAX_BYTES = 255;

    it('leaves a name that is exactly at the byte limit untouched', () => {
      // 84 Japanese characters (252 bytes) + '.md' = 255 bytes exactly.
      const atLimit = `${'あ'.repeat(84)}.md`;
      expect(utf8Bytes(atLimit)).toBe(MAX_BYTES);
      // ASCII path of the same length, to pin the limit as bytes rather than characters.
      const asciiAtLimit = `${'a'.repeat(252)}.md`;
      expect(utf8Bytes(asciiAtLimit)).toBe(MAX_BYTES);

      const result = normalizeTree([blobNode(atLimit), blobNode(asciiAtLimit)]);

      expect(result[0].entry.path).toBe(atLimit);
      expect(result[1].entry.path).toBe(asciiAtLimit);
    });

    it('shortens a name that exceeds the byte limit and appends __<hash8> before the extension', () => {
      // 85 Japanese characters (255 bytes) + '.md' = 258 bytes — the threshold
      // reported in issue #11596.
      const stem = 'あ'.repeat(85);
      const original = `${stem}.md`;
      expect(utf8Bytes(original)).toBe(258);

      const result = normalizeTree([blobNode(original)]);
      const name = result[0].entry.path;

      expect(utf8Bytes(name)).toBeLessThanOrEqual(MAX_BYTES);
      expect(name.endsWith('.md')).toBe(true);

      // The suffix is derived from the pre-suffix full path, exactly as it is
      // for case collisions (req 4.10).
      const { kept, hash } = splitNormalizedName(name);
      expect(hash).toBe(hash8(original));

      // What is kept is a prefix of the original name — no re-encoding, no reordering.
      expect(stem.startsWith(kept)).toBe(true);
      expect(kept.length).toBeGreaterThan(0);

      // ...and it is as long as the budget allows: keeping one more character
      // of the original would push the name over the limit.
      const nextChar = [...stem][[...kept].length];
      expect(utf8Bytes(`${kept}${nextChar}__${hash}.md`)).toBeGreaterThan(
        MAX_BYTES,
      );
    });

    it('never splits a character in half when shortening', () => {
      // Emoji are 4 UTF-8 bytes each and a surrogate pair in JS. Cutting either
      // in half would leave a lone surrogate, which encodes to U+FFFD — the
      // client would see a different name than the bytes describe.
      const original = `${'🙂'.repeat(70)}.md`;
      expect(utf8Bytes(original)).toBeGreaterThan(MAX_BYTES);

      const result = normalizeTree([blobNode(original)]);
      const name = result[0].entry.path;

      expect(utf8Bytes(name)).toBeLessThanOrEqual(MAX_BYTES);
      // Round-tripping through UTF-8 is lossless only if no code point was cut.
      expect(Buffer.from(name, 'utf8').toString('utf8')).toBe(name);
      expect(name).not.toContain('�');
    });

    it('shortens over-long directory names and keeps recursing into their children', () => {
      const longDirName = 'あ'.repeat(100); // 300 bytes, no extension
      const nodes: ReadonlyArray<TreeNode> = [
        treeNode(longDirName, [blobNode('inner.md')]),
      ];

      const result = normalizeTree(nodes);
      const name = result[0].entry.path;

      expect(utf8Bytes(name)).toBeLessThanOrEqual(MAX_BYTES);
      // No extension → the suffix is appended at the end.
      expect(name).toMatch(/__[0-9a-f]{8}$/);
      expect(result[0].entry.type).toBe('tree');
      // Children are still normalized (and unaffected — they collide with nothing).
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children?.[0].entry.path).toBe('inner.md');
    });

    it('keeps two over-long names distinct when they share their leading characters', () => {
      // Both names differ only *after* the point where shortening cuts, so the
      // kept part is identical — only the hash keeps them addressable.
      const shared = 'あ'.repeat(90);
      const first = `${shared}-first.md`;
      const second = `${shared}-second.md`;

      const result = normalizeTree([blobNode(first), blobNode(second)]);
      const [nameA, nameB] = [result[0].entry.path, result[1].entry.path];

      expect(utf8Bytes(nameA)).toBeLessThanOrEqual(MAX_BYTES);
      expect(utf8Bytes(nameB)).toBeLessThanOrEqual(MAX_BYTES);
      expect(nameA).not.toBe(nameB);
      expect(splitNormalizedName(nameA).kept).toBe(
        splitNormalizedName(nameB).kept,
      );
    });

    it('fits within the limit when a name needs both a collision suffix and shortening', () => {
      // 'A…' and 'a…' collide case-insensitively. Each name is 253 bytes — it
      // fits on its own, but adding the 10-byte __<hash8> suffix would push it
      // to 263 bytes, so the collision suffix itself forces shortening.
      const upper = `A${'あ'.repeat(83)}.md`;
      const lower = `a${'あ'.repeat(83)}.md`;
      expect(utf8Bytes(upper)).toBe(253);

      const result = normalizeTree([blobNode(upper), blobNode(lower)]);

      for (const node of result) {
        const name = node.entry.path;
        expect(utf8Bytes(name)).toBeLessThanOrEqual(MAX_BYTES);
        // Exactly one suffix — not one for the collision plus one for the length.
        expect(name.match(/__[0-9a-f]{8}/g)).toHaveLength(1);
        expect(name.endsWith('.md')).toBe(true);
      }
      expect(result[0].entry.path).not.toBe(result[1].entry.path);
    });

    it('does not shorten a name that fits, even when it is close to the limit', () => {
      // Same 253-byte name as above but without a collision partner — nothing
      // forces a suffix, so it must come back byte-for-byte unchanged.
      const closeToLimit = `A${'あ'.repeat(83)}.md`;

      const result = normalizeTree([blobNode(closeToLimit)]);

      expect(result[0].entry.path).toBe(closeToLimit);
    });
  });
});
