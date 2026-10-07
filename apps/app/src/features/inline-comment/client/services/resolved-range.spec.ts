// @vitest-environment happy-dom

import type { ResolvedRange } from '../../interfaces';
import { renderedTextOf } from './rendered-text';
import { rangeForResolved, rangesById } from './resolved-range';

const createContainer = (): HTMLElement => {
  const container = document.createElement('div');
  container.textContent = 'The quick brown fox jumps over the lazy dog.';
  return container;
};

describe('rangeForResolved', () => {
  it('reconstructs a Range covering the resolved offsets for an exact/fuzzy result', () => {
    const container = createContainer();
    const renderedText = renderedTextOf(container);
    const start = 'The '.length;
    const quote = 'quick brown fox';
    const resolved: ResolvedRange = {
      status: 'exact',
      startOffset: start,
      endOffset: start + quote.length,
    };

    const range = rangeForResolved(renderedText, resolved);

    expect(range).not.toBeNull();
    expect(range?.toString()).toBe(quote);
  });

  it('returns null for a not_found result', () => {
    const container = createContainer();
    const renderedText = renderedTextOf(container);

    const range = rangeForResolved(renderedText, { status: 'not_found' });

    expect(range).toBeNull();
  });

  it('returns null when the resolved offsets no longer map to a DOM position', () => {
    const container = createContainer();
    const renderedText = renderedTextOf(container);
    const outOfBounds: ResolvedRange = {
      status: 'exact',
      startOffset: 0,
      endOffset: container.textContent?.length ?? 0 + 1000,
    };

    const range = rangeForResolved(renderedText, {
      ...outOfBounds,
      endOffset: 100000,
    });

    expect(range).toBeNull();
  });
});

describe('rangesById', () => {
  it('returns a Range keyed by comment id for each resolvable entry', () => {
    const container = createContainer();
    const start = 'The '.length;
    const quote = 'quick brown fox';
    const resolvedRanges = new Map<string, ResolvedRange>([
      [
        'c1',
        {
          status: 'exact',
          startOffset: start,
          endOffset: start + quote.length,
        },
      ],
    ]);

    const result = rangesById(container, resolvedRanges);

    expect(result.size).toBe(1);
    expect(result.get('c1')?.toString()).toBe(quote);
  });

  it('excludes entries whose resolution is not_found', () => {
    const container = createContainer();
    const start = 'The '.length;
    const quote = 'quick brown fox';
    const resolvedRanges = new Map<string, ResolvedRange>([
      [
        'c1',
        {
          status: 'exact',
          startOffset: start,
          endOffset: start + quote.length,
        },
      ],
      ['c2', { status: 'not_found' }],
    ]);

    const result = rangesById(container, resolvedRanges);

    expect(result.size).toBe(1);
    expect(result.has('c2')).toBe(false);
    expect(result.has('c1')).toBe(true);
  });

  it('returns an empty map when every entry is not_found', () => {
    const container = createContainer();
    const resolvedRanges = new Map<string, ResolvedRange>([
      ['c1', { status: 'not_found' }],
    ]);

    const result = rangesById(container, resolvedRanges);

    expect(result.size).toBe(0);
  });
});
