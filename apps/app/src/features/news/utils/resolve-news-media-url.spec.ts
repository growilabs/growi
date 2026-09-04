import { resolveNewsMediaUrl } from './resolve-news-media-url';

const FEED_URL = 'https://growilabs.github.io/growi-news-feed/feed.json';

describe('resolveNewsMediaUrl', () => {
  describe('accepts valid flat images/ paths', () => {
    test.each([
      [
        'images/release-8-0.png',
        'https://growilabs.github.io/growi-news-feed/images/release-8-0.png',
      ],
      [
        'images/demo.gif',
        'https://growilabs.github.io/growi-news-feed/images/demo.gif',
      ],
      [
        'images/photo.jpg',
        'https://growilabs.github.io/growi-news-feed/images/photo.jpg',
      ],
      [
        'images/photo.jpeg',
        'https://growilabs.github.io/growi-news-feed/images/photo.jpeg',
      ],
      [
        'images/banner.webp',
        'https://growilabs.github.io/growi-news-feed/images/banner.webp',
      ],
    ])('%s', (path, expected) => {
      expect(resolveNewsMediaUrl(path, FEED_URL)).toBe(expected);
    });
  });

  describe('rejects directory escape', () => {
    test.each([
      ['images/../secret.png'],
      ['images/../../other/x.png'],
      ['/x.png'],
      ['/growi-news-feed/x.png'],
    ])('%s', (path) => {
      expect(resolveNewsMediaUrl(path, FEED_URL)).toBeNull();
    });
  });

  describe('rejects other-site URLs on the shared Pages origin', () => {
    test.each([
      ['https://growilabs.github.io/other-repo/images/x.png'],
      ['/other-repo/images/x.png'],
      // sibling-prefix spoofing: rejected only by trailing-slash-inclusive compare
      ['https://growilabs.github.io/growi-news-feed-evil/images/x.png'],
    ])('%s', (path) => {
      expect(resolveNewsMediaUrl(path, FEED_URL)).toBeNull();
    });
  });

  describe('rejects subdirectories (flat only)', () => {
    test.each([
      ['images/sub/x.gif'],
      ['images/2026-07/foo.png'],
    ])('%s', (path) => {
      expect(resolveNewsMediaUrl(path, FEED_URL)).toBeNull();
    });
  });

  describe('rejects cross-origin and non-https', () => {
    test.each([
      ['https://evil.example.com/growi-news-feed/images/x.png'],
      ['http://growilabs.github.io/growi-news-feed/images/x.png'],
      ['//evil.example.com/images/x.png'],
      ['ftp://growilabs.github.io/growi-news-feed/images/x.png'],
    ])('%s', (path) => {
      expect(resolveNewsMediaUrl(path, FEED_URL)).toBeNull();
    });
  });

  describe('rejects URL-syntax smuggling', () => {
    test.each([
      ['images/%2e%2e/x.png'],
      ['images/x.png?v=2'],
      ['images/x.png#frag'],
      ['https://user:pass@growilabs.github.io/growi-news-feed/images/x.png'],
      ['images/'],
      [''],
    ])('%s', (path) => {
      expect(resolveNewsMediaUrl(path, FEED_URL)).toBeNull();
    });
  });

  describe('rejects disallowed extensions', () => {
    test.each([
      ['images/x.mp4'],
      ['images/x.svg'],
      ['images/x.html'],
      ['images/x'],
      ['images/.png'],
    ])('%s', (path) => {
      expect(resolveNewsMediaUrl(path, FEED_URL)).toBeNull();
    });
  });

  // Non-canonical inputs that WHATWG URL would normalize into the correct
  // in-images URL, but which violate the raw `images/<file>` relative-path
  // contract. Rejected by the raw-input guard even though they are not escapes.
  describe('rejects non-canonical input that normalizes into images/', () => {
    test.each([
      ['//growilabs.github.io/growi-news-feed/images/x.png'],
      ['https:images/x.png'],
      ['images\\x.png'],
      ['./images/x.png'],
    ])('%s', (path) => {
      expect(resolveNewsMediaUrl(path, FEED_URL)).toBeNull();
    });
  });

  test('returns null instead of throwing for an invalid feed URL', () => {
    expect(resolveNewsMediaUrl('images/x.png', 'not a url')).toBeNull();
  });
});
