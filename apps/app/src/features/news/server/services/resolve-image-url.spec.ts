import { resolveNewsImageUrl } from './resolve-image-url';

const FEED_URL = 'https://growilabs.github.io/growi-news-feed/feed.json';

describe('resolveNewsImageUrl', () => {
  describe('accepts valid relative paths inside the feed images directory', () => {
    test.each([
      [
        'images/release-8-0.png',
        'https://growilabs.github.io/growi-news-feed/images/release-8-0.png',
      ],
      [
        'images/photo.jpg',
        'https://growilabs.github.io/growi-news-feed/images/photo.jpg',
      ],
      [
        'images/banner.webp',
        'https://growilabs.github.io/growi-news-feed/images/banner.webp',
      ],
    ])('%s → %s', (path, expected) => {
      expect(resolveNewsImageUrl(path, FEED_URL)).toBe(expected);
    });
  });

  describe('rejects directory escape', () => {
    test.each([
      ['images/../secret.png'], // normalizes outside images/
      ['images/../../other/x.png'],
      ['/x.png'], // absolute path outside feed dir
      ['/growi-news-feed/x.png'], // sibling of images/
    ])('%s', (path) => {
      expect(resolveNewsImageUrl(path, FEED_URL)).toBeNull();
    });

    // The contract is containment of the RESOLVED pathname: traversal notation
    // that round-trips back inside images/ is safe here and is instead
    // rejected upstream by the zod path grammar (layer separation).
    test('accepts traversal notation that resolves back inside images/', () => {
      expect(
        resolveNewsImageUrl('../growi-news-feed/images/x.png', FEED_URL),
      ).toBe('https://growilabs.github.io/growi-news-feed/images/x.png');
    });
  });

  describe('rejects other-site URLs on the shared Pages origin', () => {
    test.each([
      ['https://growilabs.github.io/other-repo/images/x.png'],
      ['/other-repo/images/x.png'],
      // sibling-prefix spoofing: fails only with trailing-slash-inclusive compare
      ['https://growilabs.github.io/growi-news-feed-evil/images/x.png'],
    ])('%s', (path) => {
      expect(resolveNewsImageUrl(path, FEED_URL)).toBeNull();
    });
  });

  describe('rejects cross-origin and non-https', () => {
    test.each([
      ['https://evil.example.com/growi-news-feed/images/x.png'],
      ['http://growilabs.github.io/growi-news-feed/images/x.png'],
      ['//evil.example.com/images/x.png'], // protocol-relative
      ['ftp://growilabs.github.io/growi-news-feed/images/x.png'],
    ])('%s', (path) => {
      expect(resolveNewsImageUrl(path, FEED_URL)).toBeNull();
    });
  });

  describe('rejects URL syntax smuggling', () => {
    test.each([
      ['images/%2e%2e/x.png'], // percent-encoded traversal
      ['images/x.png?v=2'], // query
      ['images/x.png#frag'], // hash
      ['https://user:pass@growilabs.github.io/growi-news-feed/images/x.png'], // credentials
      ['images/'], // directory itself, not a file
      [''], // empty resolves to the feed file itself
    ])('%s', (path) => {
      expect(resolveNewsImageUrl(path, FEED_URL)).toBeNull();
    });
  });

  test('returns null instead of throwing for an invalid base URL', () => {
    expect(resolveNewsImageUrl('images/x.png', 'not a url')).toBeNull();
  });

  // WHATWG URL canonicalization edge cases: pin the resolve-layer verdict
  // directly so the security contract cannot regress unnoticed even where the
  // zod grammar would already reject the input.
  describe('URL canonicalization edge cases', () => {
    test.each([
      ['images\\..\\secret.png'], // backslashes normalize to slashes → escapes images/
      ['\\\\evil.example.com\\x.png'], // backslash protocol-relative → foreign origin
      ['https://growilabs.github.io./growi-news-feed/images/x.png'], // trailing-dot host ≠ feed host
      ['https://growilabs.xn--github-9d3c.io/growi-news-feed/images/x.png'], // punycode host ≠ feed host
    ])('rejects %s', (path) => {
      expect(resolveNewsImageUrl(path, FEED_URL)).toBeNull();
    });

    test.each([
      // uppercase scheme canonicalizes to https
      [
        'HTTPS://growilabs.github.io/growi-news-feed/images/x.png',
        'https://growilabs.github.io/growi-news-feed/images/x.png',
      ],
      // explicit default port is dropped during canonicalization
      [
        'https://growilabs.github.io:443/growi-news-feed/images/x.png',
        'https://growilabs.github.io/growi-news-feed/images/x.png',
      ],
      // same-scheme relative reference resolves against the feed directory
      [
        'https:images/x.png',
        'https://growilabs.github.io/growi-news-feed/images/x.png',
      ],
    ])('canonicalizes %s into the contained URL', (path, expected) => {
      expect(resolveNewsImageUrl(path, FEED_URL)).toBe(expected);
    });
  });
});
