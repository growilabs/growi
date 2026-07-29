import {
  selectAlternateMdUrl,
  toMarkdownAlternateLinkHeader,
} from './page-markdown-alternate';
import { toPermalinkMdUrl } from './page-markdown-url';

describe('selectAlternateMdUrl', () => {
  test('returns the permalink-form ".md" URL when only a pageId is given', () => {
    const result = selectAlternateMdUrl('507f1f77bcf86cd799439011', undefined);
    expect(result).toBe('/507f1f77bcf86cd799439011.md');
  });

  test('prefers the pageId over the pathname when both are given', () => {
    const result = selectAlternateMdUrl('507f1f77bcf86cd799439011', '/foo/bar');
    expect(result).toBe('/507f1f77bcf86cd799439011.md');
  });

  test('falls back to the path-form ".md" URL when no pageId is given (empty/container page)', () => {
    const result = selectAlternateMdUrl(undefined, '/foo/bar');
    expect(result).toBe('/foo/bar.md');
  });

  test('returns null when neither a pageId nor a pathname is available', () => {
    expect(selectAlternateMdUrl(undefined, undefined)).toBeNull();
    expect(selectAlternateMdUrl(null, null)).toBeNull();
  });

  test('returns null for an empty-string pathname (avoids a broken "/.md" href)', () => {
    expect(selectAlternateMdUrl(undefined, '')).toBeNull();
  });
});

describe('toMarkdownAlternateLinkHeader', () => {
  test('wraps the URL in the RFC 8288 alternate Link header value', () => {
    const result = toMarkdownAlternateLinkHeader(
      '/507f1f77bcf86cd799439011.md',
    );
    expect(result).toBe(
      '</507f1f77bcf86cd799439011.md>; rel="alternate"; type="text/markdown"',
    );
  });

  test('produces the permalink-form Link header value from a pageId (Requirement 6.2)', () => {
    const result = toMarkdownAlternateLinkHeader(
      toPermalinkMdUrl('507f1f77bcf86cd799439011'),
    );
    expect(result).toBe(
      '</507f1f77bcf86cd799439011.md>; rel="alternate"; type="text/markdown"',
    );
  });
});
