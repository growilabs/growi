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
   * Where each UTF-16 code unit of `text` came from: `[sourceStarts[i],
   * sourceEnds[i])` in the markdown, or `NO_SOURCE` in both when the
   * character has no place in the markdown (e.g. the newline between two
   * blocks). Typed arrays keep a long page to a few bytes per character.
   */
  readonly sourceStarts: Int32Array;
  readonly sourceEnds: Int32Array;
  /** Code blocks the browser draws as diagrams; their source is not in `text`. */
  readonly diagramBlocks: readonly SourceSpan[];
}

/** Marks a character with no source; markdown offsets are never negative. */
export const NO_SOURCE = -1;

const DIAGRAM_LANGUAGES: ReadonlySet<string> = new Set([
  'drawio',
  'mermaid',
  'plantuml',
]);

interface WalkState {
  readonly markdown: string;
  readonly chunks: string[];
  /** Grown by doubling; only the first `length` entries are meaningful. */
  starts: Int32Array;
  ends: Int32Array;
  length: number;
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

const ensureCapacity = (state: WalkState, extra: number): void => {
  const needed = state.length + extra;
  if (needed <= state.starts.length) return;
  let capacity = state.starts.length * 2;
  while (capacity < needed) capacity *= 2;
  const starts = new Int32Array(capacity);
  starts.set(state.starts);
  const ends = new Int32Array(capacity);
  ends.set(state.ends);
  state.starts = starts;
  state.ends = ends;
};

const writeNoSource = (state: WalkState, count: number): void => {
  state.starts.fill(NO_SOURCE, state.length, state.length + count);
  state.ends.fill(NO_SOURCE, state.length, state.length + count);
  state.length += count;
};

/** Writes `count` characters that map one to one onto the markdown from `sourceStart`. */
const writeIdentity = (
  state: WalkState,
  sourceStart: number,
  count: number,
): void => {
  for (let i = 0; i < count; i++) {
    state.starts[state.length + i] = sourceStart + i;
    state.ends[state.length + i] = sourceStart + i + 1;
  }
  state.length += count;
};

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
const writeAligned = (
  state: WalkState,
  value: string,
  window: SourceSpan,
): void => {
  const slice = state.markdown.slice(window.start, window.end);
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

  writeIdentity(state, window.start, prefixLength);

  const middleStart = window.start + prefixLength;
  const middleEnd = window.end - suffixLength;
  const middleSlice = slice.slice(prefixLength, slice.length - suffixLength);
  const middleLength = value.length - prefixLength - suffixLength;
  const { starts, ends } = state;
  const base = state.length;

  // Forward: a matched character maps to its offset; an unmatched one starts
  // where its previous matched neighbour ends (its end is filled below).
  let searchFrom = 0;
  let previousEnd = middleStart;
  for (let k = 0; k < middleLength; k++) {
    const found = indexWithin(middleSlice, value[prefixLength + k], searchFrom);
    if (found === -1) {
      starts[base + k] = previousEnd;
      ends[base + k] = NO_SOURCE;
    } else {
      starts[base + k] = middleStart + found;
      ends[base + k] = middleStart + found + 1;
      previousEnd = middleStart + found + 1;
      searchFrom = found + 1;
    }
  }
  // Backward: an unmatched character ends where its next matched neighbour starts.
  let nextStart = middleEnd;
  for (let k = middleLength - 1; k >= 0; k--) {
    if (ends[base + k] === NO_SOURCE) {
      ends[base + k] = nextStart;
    } else {
      nextStart = starts[base + k];
    }
  }
  state.length += middleLength;

  writeIdentity(state, window.end - suffixLength, suffixLength);
};

/** Writes the sources of `value`'s characters; returns false when none has a source. */
const writeSourcesOfText = (
  value: string,
  node: Text,
  scope: Scope,
  state: WalkState,
): boolean => {
  const { markdown } = state;
  const own = trustedSpanOf(node, scope.span);
  if (own != null) {
    if (
      own.end - own.start === value.length &&
      markdown.startsWith(value, own.start)
    ) {
      writeIdentity(state, own.start, value.length);
    } else {
      writeAligned(state, value, own);
    }
    return true;
  }

  // Inter-block whitespace and text placed by a plugin outside any
  // positioned element have no meaningful place in the markdown.
  if (!scope.positioned || value.trim() === '') {
    writeNoSource(state, value.length);
    return false;
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
  const found = markdown.slice(window.start, window.end).indexOf(value);
  if (found !== -1) {
    writeIdentity(state, window.start + found, value.length);
  } else {
    writeAligned(state, value, window);
  }
  return true;
};

const appendText = (
  value: string,
  node: Text,
  scope: Scope,
  state: WalkState,
): void => {
  ensureCapacity(state, value.length);
  const mapped = writeSourcesOfText(value, node, scope, state);
  state.chunks.push(value);
  if (mapped && value.length > 0) {
    state.cursor = state.ends[state.length - 1];
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
  const initialCapacity = Math.max(16, markdown.length);
  const state: WalkState = {
    markdown,
    chunks: [],
    starts: new Int32Array(initialCapacity),
    ends: new Int32Array(initialCapacity),
    length: 0,
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
    sourceStarts: state.starts.slice(0, state.length),
    sourceEnds: state.ends.slice(0, state.length),
    diagramBlocks: state.diagramBlocks,
  };
}
