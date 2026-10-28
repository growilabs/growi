import { describe, expect, it } from 'vitest';

import { decodePathname, hashPagePath, isPageRoute } from './hash-page-path';

describe('hashPagePath', () => {
  it.each`
    description                  | path                             | expected
    ${'user subpage path'}       | ${'/user/john/projects'}         | ${'/user/[USERNAME_HASHED:96d9632f363564cc]/[HASHED:2577c0f557b2e4b5]'}
    ${'user homepage'}           | ${'/user/john'}                  | ${'/user/[USERNAME_HASHED:96d9632f363564cc]'}
    ${'complex path'}            | ${'/wiki/project/documentation'} | ${'/[HASHED:22ca1a8b9f281349]'}
    ${'path with special chars'} | ${'/user-name_123/project!'}     | ${'/[HASHED:7aa6a8f4468baa96]'}
    ${'path with a trailing /'}  | ${'/wiki/page/'}                 | ${'/[HASHED:2f4a824f8eacbc70]/'}
  `('should hash $description', ({ path, expected }) => {
    expect(hashPagePath(path)).toBe(expected);
  });

  it('should return a permalink as-is', () => {
    expect(hashPagePath('/58a4569921a8424d00a1aa0e')).toBe(
      '/58a4569921a8424d00a1aa0e',
    );
  });

  it('should hash a non-ASCII page path the same whether it was encoded in upper or lower case', () => {
    const raw = hashPagePath(decodePathname('/Sandbox/日本語'));
    const upper = hashPagePath(
      decodePathname('/Sandbox/%E6%97%A5%E6%9C%AC%E8%AA%9E'),
    );
    const lower = hashPagePath(
      decodePathname('/Sandbox/%e6%97%a5%e6%9c%ac%e8%aa%9e'),
    );

    expect(raw).toMatch(/^\/\[HASHED:[a-f0-9]{16}\]$/);
    expect(upper).toBe(raw);
    expect(lower).toBe(raw);
  });

  it('should hash a page name containing a "." instead of leaving it as-is', () => {
    expect(hashPagePath('/Sandbox/v1.2.3')).toMatch(
      /^\/\[HASHED:[a-f0-9]{16}\]$/,
    );
  });
});

describe('decodePathname', () => {
  it('should return a malformed encoding as-is', () => {
    expect(decodePathname('/Sandbox/%E6%97')).toBe('/Sandbox/%E6%97');
  });
});

describe('isPageRoute', () => {
  it.each`
    description                         | path                 | expected
    ${'page path'}                      | ${'/path/to/page'}   | ${true}
    ${'page name containing a "."'}     | ${'/Sandbox/v1.2.3'} | ${true}
    ${'non-ASCII page path'}            | ${'/Sandbox/日本語'} | ${true}
    ${'page path decoding to a "?"'}    | ${'/Sandbox/a?b'}    | ${true}
    ${'API endpoint'}                   | ${'/_api/v3/search'} | ${false}
    ${'API endpoint decoding to a "?"'} | ${'/_api?v3'}        | ${false}
  `('should return $expected for $description', ({ path, expected }) => {
    expect(isPageRoute(path)).toBe(expected);
  });
});
