import type { Element, Root, Text } from 'hast';

/** A [start, end) range of UTF-16 code units in the page body markdown. */
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * The server-side counterpart of the browser's `renderedTextOf` text, with
 * where each character came from in the markdown.
 */
export interface RenderedTextWithSource {
  readonly text: string;
  /**
   * One entry per UTF-16 code unit of `text`. `null` when the character has
   * no place in the markdown (e.g. the newline between two blocks).
   */
  readonly sources: readonly (SourceSpan | null)[];
  /** Code blocks the browser draws as diagrams; their source is not in `text`. */
  readonly diagramBlocks: readonly SourceSpan[];
}

const DIAGRAM_LANGUAGES: ReadonlySet<string> = new Set([
  'drawio',
  'mermaid',
  'plantuml',
]);

interface WalkState {
  readonly markdown: string;
  readonly chunks: string[];
  readonly sources: (SourceSpan | null)[];
  readonly diagramBlocks: SourceSpan[];
  /** Source end of the last mapped character; text without a position is searched for after it. */
  cursor: number;
}

interface Scope {
  /** Span of the nearest ancestor whose position could be trusted. */
  readonly span: SourceSpan;
  /** False while that ancestor is the root, which says nothing about where a text is. */
  readonly positioned: boolean;
}

const classNamesOf = (element: Element): string[] => {
  const { className } = element.properties;
  if (Array.isArray(className)) return className.map(String);
  if (typeof className === 'string') return className.split(/\s+/);
  return [];
};

// The same exclusion as the browser's `renderedTextOf` (client/services/rendered-text.ts).
// The text output does not run KaTeX, so a formula is still the remark-math
// `code.language-math` element the browser's KaTeX would turn into `.katex`.
const isExcludedRoot = (element: Element): boolean => {
  const { ariaHidden } = element.properties;
  const classNames = classNamesOf(element);
  return (
    classNames.includes('katex') ||
    classNames.includes('language-math') ||
    ariaHidden === true ||
    ariaHidden === 'true'
  );
};

const diagramLanguageOf = (code: Element): string | undefined =>
  classNamesOf(code)
    .map((className) => /^language-(\w+)/.exec(className)?.[1])
    .find((language) => language != null && DIAGRAM_LANGUAGES.has(language));

/**
 * A node's position, unless it falls outside its ancestor's: some plugins
 * (xsv-to-table) build their output from a re-parsed string whose offsets do
 * not point into the page body.
 */
const trustedSpanOf = (
  node: Element | Text,
  within: SourceSpan,
): SourceSpan | null => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start == null || end == null || start > end) return null;
  if (start < within.start || end > within.end) return null;
  return { start, end };
};

const identitySpans = (start: number, length: number): SourceSpan[] =>
  Array.from({ length }, (_, i) => ({ start: start + i, end: start + i + 1 }));

/**
 * How far ahead a rendered character is looked for in the markdown: longer
 * than any entity, escape or emoji shortcode it may stand for, and short
 * enough that a character with no counterpart costs a constant amount.
 */
const ALIGNMENT_LOOKAHEAD = 64;

const indexWithin = (text: string, char: string, from: number): number => {
  const end = Math.min(text.length, from + ALIGNMENT_LOOKAHEAD);
  for (let i = from; i < end; i++) {
    if (text[i] === char) return i;
  }
  return -1;
};

/**
 * Maps each character of `value` into `window` of the markdown when they
 * differ (escapes, entities, emoji shortcodes): the common prefix and suffix
 * map one to one, the rest is matched character by character in order, and
 * a character found nowhere takes the whole gap between its matched
 * neighbours. Approximate by design (design.md「本文の markdown の一部を
 * 指定しての作成」).
 */
const alignSpans = (
  value: string,
  markdown: string,
  window: SourceSpan,
): SourceSpan[] => {
  const slice = markdown.slice(window.start, window.end);
  const maxCommon = Math.min(value.length, slice.length);

  let prefixLength = 0;
  while (
    prefixLength < maxCommon &&
    value[prefixLength] === slice[prefixLength]
  ) {
    prefixLength++;
  }
  let suffixLength = 0;
  while (
    suffixLength < maxCommon - prefixLength &&
    value[value.length - 1 - suffixLength] ===
      slice[slice.length - 1 - suffixLength]
  ) {
    suffixLength++;
  }

  const middleStart = window.start + prefixLength;
  const middleEnd = window.end - suffixLength;
  const middleSlice = markdown.slice(middleStart, middleEnd);
  const middleValue = value.slice(prefixLength, value.length - suffixLength);

  const matched: (number | null)[] = [];
  let searchFrom = 0;
  for (const char of middleValue.split('')) {
    const found = indexWithin(middleSlice, char, searchFrom);
    if (found === -1) {
      matched.push(null);
    } else {
      matched.push(middleStart + found);
      searchFrom = found + 1;
    }
  }

  // Each unmatched character spans from its previous matched neighbour's end
  // to its next matched neighbour's start.
  const gapStarts: number[] = [];
  let previousEnd = middleStart;
  for (const offset of matched) {
    gapStarts.push(previousEnd);
    if (offset != null) previousEnd = offset + 1;
  }
  const middleSpans: SourceSpan[] = new Array(matched.length);
  let nextStart = middleEnd;
  for (let i = matched.length - 1; i >= 0; i--) {
    const offset = matched[i];
    if (offset != null) {
      middleSpans[i] = { start: offset, end: offset + 1 };
      nextStart = offset;
    } else {
      middleSpans[i] = { start: gapStarts[i], end: nextStart };
    }
  }

  return [
    ...identitySpans(window.start, prefixLength),
    ...middleSpans,
    ...identitySpans(window.end - suffixLength, suffixLength),
  ];
};

const sourceSpansOfText = (
  value: string,
  node: Text,
  scope: Scope,
  state: WalkState,
): (SourceSpan | null)[] => {
  const own = trustedSpanOf(node, scope.span);
  if (own != null) {
    return state.markdown.slice(own.start, own.end) === value
      ? identitySpans(own.start, value.length)
      : alignSpans(value, state.markdown, own);
  }

  // Inter-block whitespace and text placed by a plugin outside any
  // positioned element have no meaningful place in the markdown.
  if (!scope.positioned || value.trim() === '') {
    return value.split('').map(() => null);
  }

  // The cursor only narrows the search inside the ancestor: content rendered
  // out of source order (footnote definitions) starts before it.
  const { span } = scope;
  const window = {
    start:
      state.cursor >= span.start && state.cursor <= span.end
        ? state.cursor
        : span.start,
    end: span.end,
  };
  const found = state.markdown.slice(window.start, window.end).indexOf(value);
  return found !== -1
    ? identitySpans(window.start + found, value.length)
    : alignSpans(value, state.markdown, window);
};

const appendText = (
  value: string,
  node: Text,
  scope: Scope,
  state: WalkState,
): void => {
  const spans = sourceSpansOfText(value, node, scope, state);
  state.chunks.push(value);
  for (const span of spans) {
    state.sources.push(span);
    if (span != null) state.cursor = span.end;
  }
};

const walk = (
  parent: Root | Element,
  scope: Scope,
  state: WalkState,
  isCodeBlock = false,
): void => {
  const lastIndex = parent.children.length - 1;

  parent.children.forEach((child, index) => {
    if (child.type === 'text') {
      // The browser's code block drops one trailing newline (CodeBlock.tsx).
      const value =
        isCodeBlock && index === lastIndex && child.value.endsWith('\n')
          ? child.value.slice(0, -1)
          : child.value;
      appendText(value, child, scope, state);
      return;
    }
    if (child.type !== 'element' || isExcludedRoot(child)) {
      return;
    }

    const own = trustedSpanOf(child, scope.span);
    const childScope: Scope =
      own == null ? scope : { span: own, positioned: true };

    if (
      child.tagName === 'code' &&
      parent.type === 'element' &&
      parent.tagName === 'pre'
    ) {
      if (diagramLanguageOf(child) != null) {
        if (childScope.positioned) state.diagramBlocks.push(childScope.span);
        return;
      }
      walk(child, childScope, state, true);
      return;
    }
    walk(child, childScope, state);
  });
};

/**
 * Extracts the rendered text of a hast tree with the browser's rule
 * (`renderedTextOf`: text nodes in document order, minus `.katex` and
 * `aria-hidden="true"` subtrees), keeping each character's source in
 * `markdown` — the exact string the tree was rendered from.
 */
export function renderedTextWithSourceOf(
  tree: Root,
  markdown: string,
): RenderedTextWithSource {
  const state: WalkState = {
    markdown,
    chunks: [],
    sources: [],
    diagramBlocks: [],
    cursor: 0,
  };
  walk(
    tree,
    { span: { start: 0, end: markdown.length }, positioned: false },
    state,
  );
  return {
    text: state.chunks.join(''),
    sources: state.sources,
    diagramBlocks: state.diagramBlocks,
  };
}
