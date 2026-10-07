/**
 * Unit tests for VaultPathMapper.
 *
 * Tests cover:
 *  - Pure function property (same input → same output)
 *  - Windows reserved character encoding
 *  - Windows reserved filename prefixing
 *  - No uppercase suffix (case-insensitive fs collision avoidance is handled by tree normalisation)
 *  - Orphan page relocation to _orphaned/
 *  - mapPrefix behaviour
 */

import { describe, expect, it } from 'vitest';

import { isExcludedFromVault, map, mapPrefix } from './vault-path-mapper.js';

// ---------------------------------------------------------------------------
// Basic mapping
// ---------------------------------------------------------------------------

describe('map — basic path transformation', () => {
  it('strips the leading slash and appends .md for a simple lowercase path', () => {
    expect(map('/hello/world')).toBe('hello/world.md');
  });

  it('handles a top-level page (single segment)', () => {
    expect(map('/readme')).toBe('readme.md');
  });

  it('handles deeply nested lowercase paths', () => {
    expect(map('/a/b/c/d')).toBe('a/b/c/d.md');
  });
});

// ---------------------------------------------------------------------------
// Pure function property
// ---------------------------------------------------------------------------

describe('map — pure function property', () => {
  it('returns the same output for the same inputs when called multiple times', () => {
    const pagePath = '/Some/Path/With/Upper';
    const first = map(pagePath);
    const second = map(pagePath);
    const third = map(pagePath);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});

// ---------------------------------------------------------------------------
// Windows reserved character encoding
// ---------------------------------------------------------------------------

describe('map — Windows reserved character encoding', () => {
  it('encodes < (less-than)', () => {
    const result = map('/page<name');
    expect(result).toContain('%3C');
    expect(result).not.toContain('<');
  });

  it('encodes > (greater-than)', () => {
    const result = map('/page>name');
    expect(result).toContain('%3E');
    expect(result).not.toContain('>');
  });

  it('encodes : (colon)', () => {
    const result = map('/page:name');
    expect(result).toContain('%3A');
    expect(result).not.toContain(':');
  });

  it('encodes " (double-quote)', () => {
    const result = map('/page"name');
    expect(result).toContain('%22');
    expect(result).not.toContain('"');
  });

  it('encodes / (forward-slash within a segment) — treated as a separator so not inside a segment', () => {
    // '/' is a path separator in GROWI, so '/a/b' becomes two segments.
    // Within a single segment there should be no raw '/', but if a page
    // path could somehow contain a literal slash inside a segment it should
    // be encoded. The mapper splits on '/' first, so this test is N/A for
    // normal usage. We test the segment encoding logic via backslash instead.
    const result = map('/page\\name');
    expect(result).toContain('%5C');
    expect(result).not.toContain('\\');
  });

  it('encodes | (pipe)', () => {
    const result = map('/page|name');
    expect(result).toContain('%7C');
    expect(result).not.toContain('|');
  });

  it('encodes ? (question-mark)', () => {
    const result = map('/page?name');
    expect(result).toContain('%3F');
    expect(result).not.toContain('?');
  });

  it('encodes * (asterisk)', () => {
    const result = map('/page*name');
    expect(result).toContain('%2A');
    expect(result).not.toContain('*');
  });
});

// ---------------------------------------------------------------------------
// Windows reserved filename prefixing
// ---------------------------------------------------------------------------

describe('map — Windows reserved filename prefix', () => {
  const reservedNames = [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9',
  ];

  for (const name of reservedNames) {
    it(`prefixes reserved filename '${name}' with underscore`, () => {
      const pagePath = `/${name}`;
      const result = map(pagePath);
      // Reserved names like CON/PRN are uppercase but no suffix is added.
      // The segment before .md must start with '_<name>'.
      const segmentWithoutExt = result.replace(/\.md$/, '');
      expect(segmentWithoutExt.startsWith(`_${name}`)).toBe(true);
    });
  }

  it('is case-insensitive for reserved name detection (lowercase)', () => {
    const result = map('/con');
    expect(result).toBe('_con.md');
  });

  it('does not prefix non-reserved names', () => {
    expect(map('/notes')).toBe('notes.md');
    expect(map('/contest')).toBe('contest.md');
  });
});

// ---------------------------------------------------------------------------
// Uppercase paths — no suffix applied (req 3.5)
// ---------------------------------------------------------------------------

describe('map — uppercase paths produce no suffix', () => {
  it('does NOT append any suffix when pagePath contains uppercase letters', () => {
    const result = map('/MyPage');
    expect(result).toBe('MyPage.md');
  });

  it('does NOT append suffix when pagePath is entirely lowercase', () => {
    const result = map('/mypage');
    expect(result).toBe('mypage.md');
  });

  it('returns plain encoded path even when uppercase appears in a middle segment', () => {
    const result = map('/a/B/c');
    expect(result).toBe('a/B/c.md');
  });

  it('returns Sandbox/test.md for /Sandbox/test', () => {
    const result = map('/Sandbox/test');
    expect(result).toBe('Sandbox/test.md');
  });

  it('output never contains __<hash> suffix', () => {
    const paths = ['/MyPage', '/a/B/c', '/Sandbox/test', '/Upper', '/CON'];
    for (const p of paths) {
      expect(map(p)).not.toMatch(/__[0-9a-f]{8}/);
    }
  });
});

// ---------------------------------------------------------------------------
// isExcludedFromVault
// ---------------------------------------------------------------------------

describe('isExcludedFromVault', () => {
  it('returns true for /trash', () => {
    expect(isExcludedFromVault('/trash')).toBe(true);
  });

  it('returns true for pages under /trash/', () => {
    expect(isExcludedFromVault('/trash/foo')).toBe(true);
  });

  it('returns false for regular pages', () => {
    expect(isExcludedFromVault('/foo')).toBe(false);
  });

  it('returns false for paths that merely contain "trash" elsewhere', () => {
    expect(isExcludedFromVault('/my-trash')).toBe(false);
    expect(isExcludedFromVault('/notes/trash')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// map — trash pages (caller's responsibility, no _orphaned/ prefix)
// ---------------------------------------------------------------------------

describe('map — trash pages are mapped without _orphaned/ prefix', () => {
  it('maps /trash/foo without _orphaned/ prefix', () => {
    const result = map('/trash/foo');
    expect(result.startsWith('_orphaned/')).toBe(false);
    expect(result).toBe('trash/foo.md');
  });

  it('maps /trash itself without _orphaned/ prefix', () => {
    const result = map('/trash');
    expect(result.startsWith('_orphaned/')).toBe(false);
    expect(result).toBe('trash.md');
  });

  it('maps /trash/A/B without suffix and without _orphaned/ prefix', () => {
    const result = map('/trash/A/B');
    expect(result.startsWith('_orphaned/')).toBe(false);
    expect(result).toBe('trash/A/B.md');
  });
});

// ---------------------------------------------------------------------------
// mapPrefix
// ---------------------------------------------------------------------------

describe('mapPrefix', () => {
  it('returns a directory prefix without .md extension', () => {
    expect(mapPrefix('/a/b/c')).toBe('a/b/c');
  });

  it('encodes reserved characters in prefix segments', () => {
    const result = mapPrefix('/a<b/c');
    expect(result).toContain('%3C');
    expect(result).not.toContain('<');
  });

  it('prefixes reserved names in prefix segments', () => {
    const result = mapPrefix('/CON/sub');
    expect(result.startsWith('_CON/')).toBe(true);
  });

  it('is a pure function — same input always produces same output', () => {
    const prefix = '/Users/Admin';
    expect(mapPrefix(prefix)).toBe(mapPrefix(prefix));
  });

  it('does not append .md', () => {
    const result = mapPrefix('/hello/world');
    expect(result.endsWith('.md')).toBe(false);
    expect(result).toBe('hello/world');
  });
});
