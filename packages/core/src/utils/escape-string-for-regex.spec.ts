import { describe, expect, test } from 'vitest';

import { escapeStringForMongoRegex } from './escape-string-for-regex.js';

describe('escapeStringForMongoRegex', () => {
  test('escapes regex metacharacters', () => {
    expect(escapeStringForMongoRegex('a.b*c+d?e')).toBe('a\\.b\\*c\\+d\\?e');
    expect(escapeStringForMongoRegex('(group)[set]{n}')).toBe(
      '\\(group\\)\\[set\\]\\{n\\}',
    );
    expect(escapeStringForMongoRegex('^start$ | end\\')).toBe(
      '\\^start\\$ \\| end\\\\',
    );
  });

  test('escapes hyphen as \\x2d (escape-string-regexp v5 behavior)', () => {
    expect(escapeStringForMongoRegex('a-b')).toBe('a\\x2db');
  });

  test('does NOT escape forward slash or ASCII space', () => {
    // The .source getter still renders "/" as "\/", but the escaped string itself keeps "/" literal.
    expect(escapeStringForMongoRegex('/parent/child')).toBe('/parent/child');
    expect(escapeStringForMongoRegex('a b')).toBe('a b');
  });

  // Core property of the fix: unlike RegExp.escape(), this must NOT emit \uXXXX,
  // because MongoDB's PCRE2 engine rejects \u (error 51091).
  test('passes non-ASCII whitespace through literally (no \\u escape)', () => {
    const ideographicSpace = '　'; // full-width space
    const escaped = escapeStringForMongoRegex(`/page${ideographicSpace}title`);
    expect(escaped).toContain(ideographicSpace);
    expect(escaped).not.toContain('\\u');
  });

  test.each([
    ' ',
    ' ',
    ' ',
    ' ',
    ' ',
    ' ',
    ' ',
    ' ',
    ' ',
    '　',
  ])('does not emit \\u for whitespace char %j', (ws) => {
    expect(escapeStringForMongoRegex(`x${ws}y`)).not.toContain('\\u');
  });

  test('produces a pattern that literally matches the original string', () => {
    for (const s of [
      '/parent/全角　space', // U+3000
      '/a.b+c?(d)[e]',
      '/path-with-hyphen',
      '/nbsp here',
    ]) {
      const re = new RegExp(`^${escapeStringForMongoRegex(s)}$`);
      expect(re.test(s)).toBe(true);
    }
  });
});
