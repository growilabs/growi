import { exceedsMaxPageDepth } from './exceeds-max-page-depth.js';

describe('exceedsMaxPageDepth', () => {
  it.each([
    { depth: 1, trailingSlash: false, expected: false },
    { depth: 129, trailingSlash: false, expected: false },
    { depth: 129, trailingSlash: true, expected: false },
    { depth: 130, trailingSlash: false, expected: true },
    { depth: 130, trailingSlash: true, expected: true },
    { depth: 131, trailingSlash: false, expected: true },
  ])('depth $depth (trailing slash: $trailingSlash) exceeds the limit: $expected', ({
    depth,
    trailingSlash,
    expected,
  }) => {
    const path = `${'/seg'.repeat(depth)}${trailingSlash ? '/' : ''}`;
    expect(exceedsMaxPageDepth(path)).toBe(expected);
  });

  it('does not apply to a path without a leading slash', () => {
    expect(exceedsMaxPageDepth(`seg${'/seg'.repeat(200)}`)).toBe(false);
  });

  it('returns quickly for a path far deeper than the limit', () => {
    const start = performance.now();
    exceedsMaxPageDepth('/LongSegment'.repeat(4000));
    expect(performance.now() - start).toBeLessThan(100);
  });
});
