// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';

import { renderedTextOf } from '../../services/rendered-text';
import { captureSelection, useTextSelection } from './use-text-selection';

/**
 * Builds a container element holding `text` as a single text node, appended
 * to document.body so Range/Selection APIs can operate on it.
 */
const mountContainer = (text: string): HTMLDivElement => {
  const container = document.createElement('div');
  container.textContent = text;
  document.body.appendChild(container);
  return container;
};

/**
 * Selects [start, end) (UTF-16 code units) of `container`'s single text
 * node as the live window selection, using the real Selection/Range APIs
 * (no Selection mocking) so the code under test exercises the same DOM
 * contract it will see in a real browser.
 */
const selectRange = (
  container: HTMLDivElement,
  start: number,
  end: number,
): Selection => {
  const textNode = container.firstChild;
  if (textNode == null) {
    throw new Error('container has no text node');
  }
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const selection = window.getSelection();
  if (selection == null) {
    throw new Error('window.getSelection() returned null');
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

/** Selects [start, end) of an arbitrary text node as the live window selection. */
const selectRangeIn = (
  textNode: Text,
  start: number,
  end: number,
): Selection => {
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const selection = window.getSelection();
  if (selection == null) {
    throw new Error('window.getSelection() returned null');
  }
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

/** The accessibility-only text KaTeX keeps in its `.katex-mathml` subtree. */
const KATEX_ACCESSIBILITY_TEXT = 'x2+y2';

/**
 * Builds a container whose text starts with a KaTeX formula — whose subtree holds
 * the same formula text twice (`.katex-mathml` for screen readers plus
 * `.katex-html` for display) — followed by a plain tail text node.
 *
 * `container.textContent` therefore counts characters that highlight resolution
 * (`renderedTextOf`) deliberately excludes, which is exactly the mismatch that
 * shifted every offset after a formula.
 */
const mountKatexContainer = (): {
  container: HTMLDivElement;
  tailNode: Text;
} => {
  const container = document.createElement('div');

  const katexRoot = document.createElement('span');
  katexRoot.className = 'katex';
  const mathml = document.createElement('span');
  mathml.className = 'katex-mathml';
  mathml.textContent = KATEX_ACCESSIBILITY_TEXT;
  const katexHtml = document.createElement('span');
  katexHtml.className = 'katex-html';
  katexHtml.textContent = KATEX_ACCESSIBILITY_TEXT;
  katexRoot.append(mathml, katexHtml);

  const tailNode = document.createTextNode('HEADSELECTMETAIL');
  container.append(katexRoot, tailNode);
  document.body.appendChild(container);

  return { container, tailNode };
};

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('captureSelection', () => {
  it('returns null for a collapsed (empty) selection', () => {
    const container = mountContainer('hello world');
    const selection = selectRange(container, 3, 3);

    const result = captureSelection(selection, container);

    expect(result).toBeNull();
  });

  it('returns null when there is no selection at all', () => {
    const container = mountContainer('hello world');

    const result = captureSelection(null, container);

    expect(result).toBeNull();
  });

  it('captures quote/prefix/suffix/approxOffset for a plain ASCII selection', () => {
    const text = `${'A'.repeat(50)}SELECT${'B'.repeat(50)}`;
    const container = mountContainer(text);
    const selection = selectRange(container, 50, 56); // "SELECT"

    const result = captureSelection(selection, container);

    expect(result).not.toBeNull();
    expect(result?.quote).toBe('SELECT');
    expect(result?.prefix).toBe('A'.repeat(40)); // default target window size
    expect(result?.suffix).toBe('B'.repeat(40));
    expect(result?.approxOffset).toBe(50);
  });

  it('preserves the exact, unnormalized quote text (no NFC normalization)', () => {
    // "e" + U+0301 (COMBINING ACUTE ACCENT): a decomposed (NFD) accented "e",
    // kept as two code units rather than composed into the single U+00E9 code point.
    const decomposedE = `e${'́'}`;
    const composedE = 'é';
    const text = `caf${decomposedE}`;
    const container = mountContainer(text);
    const selection = selectRange(container, 3, 5); // the decomposed "e" + accent

    const result = captureSelection(selection, container);

    expect(result?.quote).toBe(decomposedE);
    expect(result?.quote).not.toBe(composedE);
  });

  it('does not split a combining-character grapheme cluster when snapping the prefix window inward', () => {
    // "e" + U+0301 (COMBINING ACUTE ACCENT) forms one grapheme cluster spanning 2 code units.
    // Layout: "AB" + "e" + U+0301 + "CD" -> indices A(0) B(1) e(2) U+0301(3) C(4) D(5).
    const combiningAcuteAccent = '́';
    const text = `ABe${combiningAcuteAccent}CD`;
    const container = mountContainer(text);
    const selection = selectRange(container, 4, 6); // "CD"

    // targetWindowSize=1 makes the "ideal" (unsnapped) boundary land at index 3,
    // i.e. right on the combining mark itself — a naive code-unit slice would
    // yield the lone combining accent detached from its base "e".
    const result = captureSelection(selection, container, {
      targetWindowSize: 1,
    });

    expect(result).not.toBeNull();
    // Snapping inward past the whole cluster yields an empty window, never a split cluster.
    expect(result?.prefix).toBe('');
    expect(result?.prefix).not.toBe(combiningAcuteAccent);
  });

  it('does not split a surrogate-pair emoji when snapping the suffix window inward', () => {
    // U+1F44D (👍 THUMBS UP SIGN) is a single grapheme made of a UTF-16 surrogate pair (2 code units).
    // Layout: "AB" + thumbs-up + "CD" -> indices A(0) B(1) [high](2) [low](3) C(4) D(5).
    const thumbsUp = '\u{1F44D}';
    const text = `AB${thumbsUp}CD`;
    const container = mountContainer(text);
    const selection = selectRange(container, 0, 2); // "AB"

    // targetWindowSize=1 makes the "ideal" (unsnapped) boundary land at index 3,
    // i.e. inside the surrogate pair — a naive code-unit slice would yield an
    // unpaired lone surrogate.
    const result = captureSelection(selection, container, {
      targetWindowSize: 1,
    });

    expect(result).not.toBeNull();
    expect(result?.suffix).toBe('');
    expect(result?.suffix).not.toBe(thumbsUp[0]); // the lone high surrogate
  });

  it('counts approxOffset the same way anchor resolution does, for a selection right after a KaTeX formula', () => {
    const { container, tailNode } = mountKatexContainer();
    // "SELECTME" — the 4 code units "HEAD" precede it inside the tail text node.
    const selection = selectRangeIn(tailNode, 4, 12);

    const result = captureSelection(selection, container);

    expect(result?.quote).toBe('SELECTME');
    // Independently computed by the very module highlight resolution counts with.
    expect(result?.approxOffset).toBe(
      renderedTextOf(container).textOffsetOf(tailNode, 4),
    );
    // The KaTeX subtree contributes nothing, so the offset is the tail-node one.
    expect(result?.approxOffset).toBe(4);
  });

  it('builds prefix/suffix from the resolution-side text, excluding aria-hidden and KaTeX subtrees', () => {
    const { container, tailNode } = mountKatexContainer();
    const decoration = document.createElement('span');
    decoration.setAttribute('aria-hidden', 'true');
    decoration.textContent = 'edit_square';
    container.insertBefore(decoration, tailNode);

    const selection = selectRangeIn(tailNode, 4, 12);

    const result = captureSelection(selection, container);

    // Raw textContent would have put the formula's accessibility text and the
    // decorative icon text into the prefix window.
    expect(container.textContent).toContain(KATEX_ACCESSIBILITY_TEXT);
    expect(container.textContent).toContain('edit_square');
    expect(result?.prefix).toBe('HEAD');
    expect(result?.suffix).toBe('TAIL');
  });
});

describe('useTextSelection', () => {
  it('returns the captured selection scoped to the container, updating on selectionchange', () => {
    const container = mountContainer('hello inline comment world');
    const containerRef = { current: container };

    const { result } = renderHook(() => useTextSelection(containerRef));

    expect(result.current).toBeNull();

    act(() => {
      selectRange(container, 6, 12); // "inline"
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(result.current?.quote).toBe('inline');
  });

  it('returns null once the selection collapses back to empty', () => {
    const container = mountContainer('hello inline comment world');
    const containerRef = { current: container };

    const { result } = renderHook(() => useTextSelection(containerRef));

    act(() => {
      selectRange(container, 6, 12);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(result.current?.quote).toBe('inline');

    act(() => {
      selectRange(container, 6, 6);
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(result.current).toBeNull();
  });
});
