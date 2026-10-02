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
});
