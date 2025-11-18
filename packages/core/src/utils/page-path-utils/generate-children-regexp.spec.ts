import { describe, expect, test } from 'vitest';

import { generateChildrenRegExp } from './generate-children-regexp';

describe('generateChildrenRegExp', () => {
  describe.each([
    {
      path: '/',
      expected: '^\\/[^/]+$',
      validPaths: ['/child', '/test'],
      invalidPaths: ['/', '/child/grandchild'],
    },
    {
      path: '/parent',
      expected: '^\\/parent(\\/[^/]+)\\/?$',
      validPaths: ['/parent/child', '/parent/test'],
      invalidPaths: ['/parent', '/parent/child/grandchild', '/other/path'],
    },
    {
      path: '/parent (with brackets)',
      expected: '^\\/parent \\(with brackets\\)(\\/[^/]+)\\/?$',
      validPaths: [
        '/parent (with brackets)/child',
        '/parent (with brackets)/test',
      ],
      invalidPaths: [
        '/parent (with brackets)',
        '/parent (with brackets)/child/grandchild',
      ],
    },
    {
      path: '/parent[with square]',
      expected: '^\\/parent\\[with square\\](\\/[^/]+)\\/?$',
      validPaths: ['/parent[with square]/child', '/parent[with square]/test'],
      invalidPaths: [
        '/parent[with square]',
        '/parent[with square]/child/grandchild',
      ],
    },
    {
      path: '/parent*with+special?chars',
      expected: '^\\/parent\\*with\\+special\\?chars(\\/[^/]+)\\/?$',
      validPaths: [
        '/parent*with+special?chars/child',
        '/parent*with+special?chars/test',
      ],
      invalidPaths: [
        '/parent*with+special?chars',
        '/parent*with+special?chars/child/grandchild',
      ],
    },
  ])('with path: $path', ({ path, expected, validPaths, invalidPaths }) => {
    test('should generate correct regexp pattern', () => {
      const result = generateChildrenRegExp(path);
      expect(result.source).toBe(expected);
    });

    test.each(validPaths)('should match valid path: %s', (validPath) => {
      const result = generateChildrenRegExp(path);
      expect(validPath).toMatch(result);
    });

    test.each(invalidPaths)(
      'should not match invalid path: %s',
      (invalidPath) => {
        const result = generateChildrenRegExp(path);
        expect(invalidPath).not.toMatch(result);
      },
    );
  });
});
