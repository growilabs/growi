import type { RefObject } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedRange } from '../../../interfaces';
import { InlineCommentHighlight } from './InlineCommentHighlight';

/**
 * happy-dom implements `CSS` (escape/supports) but not the CSS Custom
 * Highlight API (`CSS.highlights`, the global `Highlight` constructor) that
 * InlineCommentHighlight relies on. A minimal in-memory stub is installed so
 * the component's own registration logic can be exercised and inspected —
 * this tests "did the component ask the browser to highlight the right
 * range", not the browser's own painting, which no jsdom/happy-dom
 * environment can render anyway.
 */
class FakeHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

describe('InlineCommentHighlight', () => {
  let container: HTMLDivElement;
  let containerRef: RefObject<HTMLElement | null>;
  let highlightRegistry: Map<string, FakeHighlight>;

  beforeEach(() => {
    container = document.createElement('div');
    container.textContent = 'The quick brown fox jumps over the lazy dog.';
    document.body.appendChild(container);
    containerRef = { current: container };

    highlightRegistry = new Map();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', {
      ...globalThis.CSS,
      highlights: highlightRegistry,
    });
  });

  afterEach(() => {
    // Unmount (running the effect's own cleanup, which touches CSS.highlights)
    // BEFORE the CSS.highlights stub is removed — RTL's own auto-cleanup
    // afterEach is registered at file scope and would otherwise run after
    // this hook, unmounting against the real (stub-less) CSS.
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const rangesOf = (): Range[] =>
    Array.from(highlightRegistry.get('growi-inline-comment')?.ranges ?? []);

  it('registers a CSS highlight covering the matched text for an exact ResolvedRange', () => {
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

    render(
      <InlineCommentHighlight
        containerRef={containerRef}
        resolvedRanges={resolvedRanges}
      />,
    );

    const ranges = rangesOf();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe(quote);
  });

  it('registers no highlight when the resolved range is not_found', () => {
    const resolvedRanges = new Map<string, ResolvedRange>([
      ['c1', { status: 'not_found' }],
    ]);

    render(
      <InlineCommentHighlight
        containerRef={containerRef}
        resolvedRanges={resolvedRanges}
      />,
    );

    expect(highlightRegistry.has('growi-inline-comment')).toBe(false);
    expect(rangesOf()).toHaveLength(0);
  });

  it('removes a previously-registered highlight once the range becomes not_found', () => {
    const start = 'The '.length;
    const quote = 'quick brown fox';

    const { rerender } = render(
      <InlineCommentHighlight
        containerRef={containerRef}
        resolvedRanges={
          new Map<string, ResolvedRange>([
            [
              'c1',
              {
                status: 'exact',
                startOffset: start,
                endOffset: start + quote.length,
              },
            ],
          ])
        }
      />,
    );
    expect(rangesOf()).toHaveLength(1);

    rerender(
      <InlineCommentHighlight
        containerRef={containerRef}
        resolvedRanges={
          new Map<string, ResolvedRange>([['c1', { status: 'not_found' }]])
        }
      />,
    );

    expect(highlightRegistry.has('growi-inline-comment')).toBe(false);
  });
});
