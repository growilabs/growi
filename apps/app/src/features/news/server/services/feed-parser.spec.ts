import { parseFeedJson } from './feed-parser';

const makeRawItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-001',
  title: { ja_JP: 'テスト', en_US: 'Test' },
  publishedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const parseSingle = (item: Record<string, unknown>) =>
  parseFeedJson({ version: '1.0', items: [item] });

describe('parseFeedJson: image field', () => {
  describe('accepts valid images', () => {
    test.each([
      ['images/release-8-0.png'],
      ['images/photo_1.jpg'],
      ['images/photo-2.jpeg'],
      ['images/banner.webp'],
    ])('%s', (path) => {
      const result = parseSingle(makeRawItem({ image: { path } }));
      expect(result?.items[0]?.image?.path).toBe(path);
    });

    test('accepts image with localized alt', () => {
      const alt = { ja_JP: '代替テキスト', en_US: 'alt text' };
      const result = parseSingle(
        makeRawItem({ image: { path: 'images/x.png', alt } }),
      );
      expect(result?.items[0]?.image?.alt).toEqual(alt);
    });
  });

  describe('drops invalid image paths (grammar layer)', () => {
    test.each([
      ['images/../secret.png'], // traversal notation
      ['images/%2e%2e/x.png'], // percent-encoding
      ['images/sub/x.png'], // nested directory not allowed
      ['images\\x.png'], // backslash
      ['images/x.png?v=2'], // query
      ['images/x.png#frag'], // hash
      ['/images/x.png'], // absolute path
      ['//evil.example.com/images/x.png'], // protocol-relative
      ['https://evil.example.com/images/x.png'], // absolute URL
      ['images/x.svg'], // SVG excluded
      ['images/x.html'], // non-raster extension
      ['images/x'], // no extension
      ['images/.png'], // dot-leading filename
      [`images/${'a'.repeat(200)}.png`], // exceeds max length
    ])('%s', (path) => {
      const result = parseSingle(makeRawItem({ image: { path } }));
      // Field-level fail-soft: the item survives, only the image is dropped
      expect(result?.items).toHaveLength(1);
      expect(result?.items[0]?.image).toBeUndefined();
    });
  });

  describe('field-level fail-soft', () => {
    test('drops image when alt text exceeds the length limit', () => {
      const result = parseSingle(
        makeRawItem({
          image: { path: 'images/x.png', alt: { ja_JP: 'あ'.repeat(501) } },
        }),
      );
      expect(result?.items).toHaveLength(1);
      expect(result?.items[0]?.image).toBeUndefined();
    });

    test('drops image when the field is malformed entirely', () => {
      const result = parseSingle(makeRawItem({ image: 'not-an-object' }));
      expect(result?.items).toHaveLength(1);
      expect(result?.items[0]?.image).toBeUndefined();
    });

    test('parses items without image exactly as before', () => {
      const result = parseSingle(makeRawItem());
      expect(result?.items).toHaveLength(1);
      expect(result?.items[0]?.image).toBeUndefined();
    });
  });
});
