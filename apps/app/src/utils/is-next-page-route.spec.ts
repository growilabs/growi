import { describe, expect, it } from 'vitest';

import { isNextPageRoute } from './is-next-page-route';

describe('isNextPageRoute', () => {
  describe('Express-exclusive paths with no corresponding Next.js page', () => {
    it.each([
      '/vault.git/info/refs',
      '/passport/google',
      '/passport/github/callback',
      '/ogp/abc123',
      '/download/abc123',
      '/attachment/abc123',
      '/uploads/abc123.png',
      '/_drawio-assets/stencils/foo.xml',
      '/Sandbox/Bootstrap5.md',
    ])('returns false for %s', (path) => {
      expect(isNextPageRoute(path)).toBe(false);
    });
  });

  describe('real Next.js page routes -- must not be denylisted just because a legacy predicate treated them as non-creatable page names', () => {
    it.each([
      '/tags',
      '/trash',
      '/user/alice',
      '/me',
      '/_search',
      '/_private-legacy-pages',
      '/_news',
      '/share/abc',
      '/admin',
      '/admin/app',
      '/login',
      '/installer',
      '/nonexistent/wiki/page/path',
    ])('returns true for %s', (path) => {
      expect(isNextPageRoute(path)).toBe(true);
    });
  });

  it('does not false-positive-match a path that merely starts with an excluded prefix', () => {
    // '/downloads' is a page path (e.g. a wiki page named "downloads"), not the
    // '/download' attachment-download endpoint.
    expect(isNextPageRoute('/downloads')).toBe(true);
  });

  describe('unsafe/malformed paths, unrelated to Express-vs-Next.js routing', () => {
    it.each([
      '/Sandbox/Bootstrap5/edit',
      '/Sandbox/50%off',
      '/../etc/passwd',
    ])('returns false for %s', (path) => {
      expect(isNextPageRoute(path)).toBe(false);
    });
  });

  describe('depth limit', () => {
    it.each([
      { depth: 129, trailingSlash: false, expected: true },
      { depth: 129, trailingSlash: true, expected: true },
      { depth: 130, trailingSlash: false, expected: false },
      { depth: 130, trailingSlash: true, expected: false },
    ])('depth $depth (trailing slash: $trailingSlash) returns $expected', ({
      depth,
      trailingSlash,
      expected,
    }) => {
      const path = `${'/seg'.repeat(depth)}${trailingSlash ? '/' : ''}`;
      expect(isNextPageRoute(path)).toBe(expected);
    });
  });

  describe('spaces around a slash', () => {
    it.each([
      ['/a /b', true],
      ['/a/ b', true],
      ['/a / b', false],
    ])('returns %s -> %s', (path, expected) => {
      expect(isNextPageRoute(path)).toBe(expected);
    });
  });

  describe('time taken for adversarial input', () => {
    const LIMIT_MS = 100;

    const elapsedMs = (path: string): number => {
      const start = performance.now();
      isNextPageRoute(path);
      return performance.now() - start;
    };

    it.each([
      ['a shallow path with many segments', '/LongSegment'.repeat(26)],
      ['a path far deeper than the limit', '/LongSegment'.repeat(4000)],
      ['a long run of whitespace', `/${' '.repeat(64000)}`],
    ])('returns within the limit for %s', (_, path) => {
      expect(elapsedMs(path)).toBeLessThan(LIMIT_MS);
    });
  });
});
