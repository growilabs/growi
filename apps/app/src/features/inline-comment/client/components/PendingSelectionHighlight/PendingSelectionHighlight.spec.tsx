import type { RefObject } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PendingSelectionHighlight } from './PendingSelectionHighlight';

/**
 * happy-dom implements `CSS` (escape/supports) but not the CSS Custom
 * Highlight API (`CSS.highlights`, the global `Highlight` constructor) that
 * PendingSelectionHighlight relies on. A minimal in-memory stub is installed
 * so the component's own registration logic can be exercised and inspected —
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

const HIGHLIGHT_NAME = 'growi-inline-comment-pending';
const SCOPE_ATTR = 'data-inline-comment-selection-scope';

describe('PendingSelectionHighlight', () => {
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
    Array.from(highlightRegistry.get(HIGHLIGHT_NAME)?.ranges ?? []);

  /** A `Range` over a slice of the container's own text node. */
  const rangeOver = (text: string): Range => {
    const textNode = container.firstChild as Text;
    const start = textNode.data.indexOf(text);
    if (start < 0) {
      throw new Error(`fixture text does not contain: ${text}`);
    }
    const range = new Range();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + text.length);
    return range;
  };

  it('registers the given range as a CSS highlight and marks the container as the selection scope', () => {
    const range = rangeOver('quick brown fox');

    render(
      <PendingSelectionHighlight range={range} containerRef={containerRef} />,
    );

    const ranges = rangesOf();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('quick brown fox');
    expect(container.hasAttribute(SCOPE_ATTR)).toBe(true);
  });

  it('removes both the CSS highlight and the scope attribute on unmount', () => {
    const { unmount } = render(
      <PendingSelectionHighlight
        range={rangeOver('quick brown fox')}
        containerRef={containerRef}
      />,
    );
    expect(highlightRegistry.has(HIGHLIGHT_NAME)).toBe(true);
    expect(container.hasAttribute(SCOPE_ATTR)).toBe(true);

    unmount();

    expect(highlightRegistry.has(HIGHLIGHT_NAME)).toBe(false);
    expect(container.hasAttribute(SCOPE_ATTR)).toBe(false);
  });

  it('registers nothing and marks nothing when the range is null', () => {
    render(
      <PendingSelectionHighlight range={null} containerRef={containerRef} />,
    );

    expect(highlightRegistry.has(HIGHLIGHT_NAME)).toBe(false);
    expect(rangesOf()).toHaveLength(0);
    expect(container.hasAttribute(SCOPE_ATTR)).toBe(false);
  });

  it('removes both once the range becomes null', () => {
    const { rerender } = render(
      <PendingSelectionHighlight
        range={rangeOver('quick brown fox')}
        containerRef={containerRef}
      />,
    );
    expect(rangesOf()).toHaveLength(1);
    expect(container.hasAttribute(SCOPE_ATTR)).toBe(true);

    rerender(
      <PendingSelectionHighlight range={null} containerRef={containerRef} />,
    );

    expect(highlightRegistry.has(HIGHLIGHT_NAME)).toBe(false);
    expect(container.hasAttribute(SCOPE_ATTR)).toBe(false);
  });

  // The `selecting` -> `composing` transition: SelectionCapture swaps the live
  // range for the committed clone while the highlight stays on screen.
  it('re-registers under the same name and keeps the scope attribute when the range changes', () => {
    const { rerender } = render(
      <PendingSelectionHighlight
        range={rangeOver('quick brown fox')}
        containerRef={containerRef}
      />,
    );
    const firstRegistration = highlightRegistry.get(HIGHLIGHT_NAME);

    rerender(
      <PendingSelectionHighlight
        range={rangeOver('lazy dog')}
        containerRef={containerRef}
      />,
    );

    expect(highlightRegistry.get(HIGHLIGHT_NAME)).not.toBe(firstRegistration);
    const ranges = rangesOf();
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('lazy dog');
    expect(container.hasAttribute(SCOPE_ATTR)).toBe(true);
  });

  it('paints both rules with the pending-token, semi-transparent color and no literal colors', () => {
    render(
      <PendingSelectionHighlight
        range={rangeOver('quick brown fox')}
        containerRef={containerRef}
      />,
    );

    // `<style jsx global>` (styled-jsx) renders a plain <style> tag in this
    // test environment, so the rule text is read straight off the document.
    // Only this component's own block is inspected, so the literal-color
    // assertions below cannot be satisfied or broken by unrelated global CSS.
    const ownStyles = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .filter((content) => content.includes(SCOPE_ATTR));
    expect(ownStyles).not.toHaveLength(0);
    const styleContent = ownStyles.join('\n');

    expect(styleContent).toContain('::selection');
    expect(styleContent).toContain(`::highlight(${HIGHLIGHT_NAME})`);

    // The pending (in-creation) highlight must use the dedicated pending
    // token, made semi-transparent via color-mix(), so a saved highlight
    // underneath stays visible when the two overlap (Requirement 1.2) — and
    // must NOT reuse the saved-highlight's opaque token/value, which
    // InlineCommentHighlight.tsx keeps using unchanged.
    const pendingBackground =
      'background-color: color-mix(in srgb, var(--grw-inline-comment-marker-bg-pending) 70%, transparent)';
    expect(styleContent).toContain(pendingBackground);
    expect(styleContent).not.toContain(
      'background-color: var(--grw-inline-comment-marker-bg)',
    );
    expect(styleContent).not.toContain(
      'background-color: var(--grw-inline-comment-marker-bg-pending);',
    );

    // Pairing the text color with the background keeps the browser's own
    // (usually white) selection text color off the pale marker background.
    expect(styleContent).toContain('color: var(--bs-body-color)');
    expect(styleContent).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(styleContent).not.toMatch(/\brgba?\(/);
  });
});
