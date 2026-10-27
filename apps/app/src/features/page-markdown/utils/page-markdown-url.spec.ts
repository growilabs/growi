import { toPathMdUrl, toPermalinkMdUrl } from './page-markdown-url';

describe('toPermalinkMdUrl', () => {
  test('returns a relative "/{pageId}.md" URL when no origin is given', () => {
    const result = toPermalinkMdUrl('507f1f77bcf86cd799439011');
    expect(result).toBe('/507f1f77bcf86cd799439011.md');
  });

  test('prefixes the origin when given', () => {
    const result = toPermalinkMdUrl(
      '507f1f77bcf86cd799439011',
      'https://example.com',
    );
    expect(result).toBe('https://example.com/507f1f77bcf86cd799439011.md');
  });
});

describe('toPathMdUrl', () => {
  test('appends ".md" to a plain path with no origin', () => {
    const result = toPathMdUrl('/foo/bar');
    expect(result).toBe('/foo/bar.md');
  });

  test('prefixes the origin when given', () => {
    const result = toPathMdUrl('/foo/bar', 'https://example.com');
    expect(result).toBe('https://example.com/foo/bar.md');
  });

  test('inserts ".md" before a query string', () => {
    const result = toPathMdUrl('/foo/bar?rev=1');
    expect(result).toBe('/foo/bar.md?rev=1');
  });

  test('inserts ".md" before a hash fragment', () => {
    const result = toPathMdUrl('/foo#sec');
    expect(result).toBe('/foo.md#sec');
  });

  test('inserts ".md" before both a query string and a trailing hash fragment', () => {
    const result = toPathMdUrl('/foo/bar?rev=1#sec');
    expect(result).toBe('/foo/bar.md?rev=1#sec');
  });

  test('appends ".md" unconditionally even when the path already ends with ".md" (Requirement 7.3)', () => {
    const result = toPathMdUrl('/README.md');
    expect(result).toBe('/README.md.md');
  });

  test('appends ".md" unconditionally before a query string when the path already ends with ".md"', () => {
    const result = toPathMdUrl('/README.md?rev=1');
    expect(result).toBe('/README.md.md?rev=1');
  });

  test('encodes spaces in the path portion without touching the query/hash', () => {
    const result = toPathMdUrl('/foo bar?q=a b#sec tion');
    expect(result).toBe('/foo%20bar.md?q=a b#sec tion');
  });
});
