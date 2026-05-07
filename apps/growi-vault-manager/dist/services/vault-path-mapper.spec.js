/**
 * Unit tests for VaultPathMapper.
 *
 * Tests cover:
 *  - Pure function property (same input → same output)
 *  - Windows reserved character encoding
 *  - Windows reserved filename prefixing
 *  - Uppercase suffix for case-insensitive fs collision avoidance
 *  - Orphan page relocation to _orphaned/
 *  - mapPrefix behaviour
 */
import { describe, expect, it } from 'vitest';

import { map, mapPrefix } from './vault-path-mapper.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PAGE_ID = '507f1f77bcf86cd799439011';
const PAGE_ID_8 = PAGE_ID.slice(0, 8); // '507f1f77'
// ---------------------------------------------------------------------------
// Basic mapping
// ---------------------------------------------------------------------------
describe('map — basic path transformation', () => {
  it('strips the leading slash and appends .md for a simple lowercase path', () => {
    expect(map('/hello/world', PAGE_ID)).toBe('hello/world.md');
  });
  it('handles a top-level page (single segment)', () => {
    expect(map('/readme', PAGE_ID)).toBe('readme.md');
  });
  it('handles deeply nested lowercase paths', () => {
    expect(map('/a/b/c/d', PAGE_ID)).toBe('a/b/c/d.md');
  });
});
// ---------------------------------------------------------------------------
// Pure function property
// ---------------------------------------------------------------------------
describe('map — pure function property', () => {
  it('returns the same output for the same inputs when called multiple times', () => {
    const pagePath = '/Some/Path/With/Upper';
    const first = map(pagePath, PAGE_ID);
    const second = map(pagePath, PAGE_ID);
    const third = map(pagePath, PAGE_ID);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
  it('returns different outputs for different pageIds when path has uppercase', () => {
    const pagePath = '/MyPage';
    const id1 = '000000001111111122222222';
    const id2 = 'aaaaaaaabbbbbbbbcccccccc';
    expect(map(pagePath, id1)).not.toBe(map(pagePath, id2));
  });
});
// ---------------------------------------------------------------------------
// Windows reserved character encoding
// ---------------------------------------------------------------------------
describe('map — Windows reserved character encoding', () => {
  it('encodes < (less-than)', () => {
    const result = map('/page<name', PAGE_ID);
    expect(result).toContain('%3C');
    expect(result).not.toContain('<');
  });
  it('encodes > (greater-than)', () => {
    const result = map('/page>name', PAGE_ID);
    expect(result).toContain('%3E');
    expect(result).not.toContain('>');
  });
  it('encodes : (colon)', () => {
    const result = map('/page:name', PAGE_ID);
    expect(result).toContain('%3A');
    expect(result).not.toContain(':');
  });
  it('encodes " (double-quote)', () => {
    const result = map('/page"name', PAGE_ID);
    expect(result).toContain('%22');
    expect(result).not.toContain('"');
  });
  it('encodes / (forward-slash within a segment) — treated as a separator so not inside a segment', () => {
    // '/' is a path separator in GROWI, so '/a/b' becomes two segments.
    // Within a single segment there should be no raw '/', but if a page
    // path could somehow contain a literal slash inside a segment it should
    // be encoded. The mapper splits on '/' first, so this test is N/A for
    // normal usage. We test the segment encoding logic via backslash instead.
    const result = map('/page\\name', PAGE_ID);
    expect(result).toContain('%5C');
    expect(result).not.toContain('\\');
  });
  it('encodes | (pipe)', () => {
    const result = map('/page|name', PAGE_ID);
    expect(result).toContain('%7C');
    expect(result).not.toContain('|');
  });
  it('encodes ? (question-mark)', () => {
    const result = map('/page?name', PAGE_ID);
    expect(result).toContain('%3F');
    expect(result).not.toContain('?');
  });
  it('encodes * (asterisk)', () => {
    const result = map('/page*name', PAGE_ID);
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
      const result = map(pagePath, PAGE_ID);
      // Reserved names like CON/PRN are uppercase, so they also receive the
      // pageId collision-avoidance suffix. The segment before .md must start
      // with '_<name>' regardless of the suffix.
      const segmentWithSuffix = result.replace(/\.md$/, '');
      expect(segmentWithSuffix.startsWith(`_${name}`)).toBe(true);
    });
  }
  it('is case-insensitive for reserved name detection (lowercase)', () => {
    const result = map('/con', PAGE_ID);
    // Lowercase 'con' has no uppercase letters, so no pageId suffix.
    expect(result).toBe('_con.md');
  });
  it('does not prefix non-reserved names', () => {
    expect(map('/notes', PAGE_ID)).toBe('notes.md');
    expect(map('/contest', PAGE_ID)).toBe('contest.md');
  });
});
// ---------------------------------------------------------------------------
// Uppercase suffix (case-insensitive fs collision avoidance)
// ---------------------------------------------------------------------------
describe('map — uppercase suffix', () => {
  it('appends __<pageId[0..7]> suffix when pagePath contains uppercase letters', () => {
    const result = map('/MyPage', PAGE_ID);
    expect(result).toBe(`MyPage__${PAGE_ID_8}.md`);
  });
  it('does NOT append suffix when pagePath is entirely lowercase', () => {
    const result = map('/mypage', PAGE_ID);
    expect(result).toBe('mypage.md');
  });
  it('appends suffix for uppercase in any segment', () => {
    const result = map('/a/B/c', PAGE_ID);
    // Entire path has uppercase, suffix is on the last segment
    expect(result).toBe(`a/B/c__${PAGE_ID_8}.md`);
  });
  it('uses exactly the first 8 chars of pageId as the suffix', () => {
    const id = 'abcdefgh12345678';
    const result = map('/Upper', id);
    expect(result).toContain('__abcdefgh');
    expect(result).not.toContain('__abcdefghi');
  });
});
// ---------------------------------------------------------------------------
// Orphan pages
// ---------------------------------------------------------------------------
describe('map — orphan pages (_orphaned/ placement)', () => {
  it('places /trash page under _orphaned/', () => {
    const result = map('/trash', PAGE_ID);
    expect(result.startsWith('_orphaned/')).toBe(true);
  });
  it('places pages under /trash/ in _orphaned/', () => {
    const result = map('/trash/old-page', PAGE_ID);
    expect(result.startsWith('_orphaned/')).toBe(true);
    expect(result).toContain('trash');
    expect(result).toContain('old-page');
  });
  it('does not place regular pages in _orphaned/', () => {
    const result = map('/notes/my-note', PAGE_ID);
    expect(result.startsWith('_orphaned/')).toBe(false);
  });
  it('preserves the encoded relative path inside _orphaned/', () => {
    const result = map('/trash/A/B', PAGE_ID);
    // Path has uppercase → suffix is added
    expect(result).toBe(`_orphaned/trash/A/B__${PAGE_ID_8}.md`);
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
//# sourceMappingURL=vault-path-mapper.spec.js.map
