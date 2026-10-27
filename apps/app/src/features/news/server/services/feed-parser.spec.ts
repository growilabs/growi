import { parseFeedJson } from './feed-parser';

const makeRawItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-001',
  title: { ja_JP: 'テスト', en_US: 'Test' },
  publishedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const parseSingle = (item: Record<string, unknown>) =>
  parseFeedJson({ version: '1.0', items: [item] });

describe('parseFeedJson: bodyFormat', () => {
  test('keeps bodyFormat when it is "markdown"', () => {
    const result = parseSingle(makeRawItem({ bodyFormat: 'markdown' }));
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.bodyFormat).toBe('markdown');
  });

  test('leaves bodyFormat undefined when absent', () => {
    const result = parseSingle(makeRawItem());
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.bodyFormat).toBeUndefined();
  });

  // Forward compatibility: a future/unknown value must NOT drop the whole item
  // (the parser skips failed items entirely). It is kept verbatim so the
  // renderer can fall back to plain text.
  test('keeps the item and the value for an unknown bodyFormat', () => {
    const result = parseSingle(makeRawItem({ bodyFormat: 'mdx' }));
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]?.bodyFormat).toBe('mdx');
  });
});
