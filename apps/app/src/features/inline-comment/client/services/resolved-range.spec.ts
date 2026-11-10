// @vitest-environment happy-dom

import type { ResolvedRange } from '../../interfaces';
import { renderedTextOf } from './rendered-text';
import { rangeForResolved, rangesById, savedRangeOf } from './resolved-range';

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

describe('rangeForResolved next to an image', () => {
  const containerWithImage = (): HTMLElement => {
    const container = document.createElement('div');
    container.innerHTML = 'Before <strong>bold</strong><img alt="pic"> after.';
    return container;
  };

  it('ends before an image that directly follows the commented text', () => {
    const container = containerWithImage();
    const start = 'Before '.length;
    const range = rangeForResolved(renderedTextOf(container), {
      status: 'exact',
      startOffset: start,
      endOffset: start + 'bold'.length,
    });

    expect(range?.toString()).toBe('bold');
    expect(range?.intersectsNode(container.querySelector('img') as Node)).toBe(
      false,
    );
  });

  it('starts after an image that directly precedes the commented text', () => {
    const container = containerWithImage();
    const start = 'Before bold'.length;
    const range = rangeForResolved(renderedTextOf(container), {
      status: 'exact',
      startOffset: start,
      endOffset: start + ' after'.length,
    });

    expect(range?.toString()).toBe(' after');
    expect(range?.intersectsNode(container.querySelector('img') as Node)).toBe(
      false,
    );
  });

  it('includes an image that sits between the commented text on both sides', () => {
    const container = containerWithImage();
    const range = rangeForResolved(renderedTextOf(container), {
      status: 'exact',
      startOffset: 'Before '.length,
      endOffset: 'Before bold after'.length,
    });

    expect(range?.intersectsNode(container.querySelector('img') as Node)).toBe(
      true,
    );
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

describe('savedRangeOf', () => {
  const setup = () => {
    const container = document.createElement('div');
    container.innerHTML = 'Before <img alt="pic"> after.';
    document.body.appendChild(container);
    const image = container.querySelector('img') as HTMLImageElement;
    return { container, image };
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('drops an image at the start edge of the selection, as a reload would', () => {
    const { container, image } = setup();
    const selection = document.createRange();
    selection.setStartBefore(image);
    selection.setEnd(container.lastChild as Node, ' after'.length);

    const saved = savedRangeOf(container, selection);

    expect(saved?.toString()).toBe(' after');
    expect(saved?.intersectsNode(image)).toBe(false);
  });

  it('drops an image at the end edge of the selection, as a reload would', () => {
    const { container, image } = setup();
    const selection = document.createRange();
    selection.setStart(container.firstChild as Node, 0);
    selection.setEndAfter(image);

    const saved = savedRangeOf(container, selection);

    expect(saved?.toString()).toBe('Before ');
    expect(saved?.intersectsNode(image)).toBe(false);
  });

  it('keeps an image that has selected text on both sides', () => {
    const { container, image } = setup();
    const selection = document.createRange();
    selection.setStart(container.firstChild as Node, 0);
    selection.setEnd(container.lastChild as Node, ' after'.length);

    const saved = savedRangeOf(container, selection);

    expect(saved?.toString()).toBe('Before  after');
    expect(saved?.intersectsNode(image)).toBe(true);
  });
});
