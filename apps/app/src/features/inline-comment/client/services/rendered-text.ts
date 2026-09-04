/**
 * The plain text extracted from a rendered container, plus a way to map an offset
 * into that text back to a DOM position (a text node + an offset within it).
 */
export interface RenderedText {
  /**
   * Plain text excluding `.katex` subtrees. lsx/drawio/mermaid output IS included:
   * this is meant to be built after those widgets have settled, so their content is
   * already resolved and part of the normal DOM text.
   */
  text: string;
  /** Maps an offset into `text` back to a DOM position, or `null` if out of bounds. */
  resolveDomPosition: (
    textOffset: number,
  ) => { node: Node; offset: number } | null;
}

/** One text node's contribution to the constructed plain text, as a [start, end) span. */
interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
}

/**
 * KaTeX renders both an accessibility-only `.katex-mathml` tree and a visual
 * `.katex-html` tree under `.katex`. Reading `textContent` naively would duplicate
 * (and garble) the formula text, so an entire `.katex` subtree is skipped. No other
 * element is excluded: code blocks render synchronously, and lsx/drawio/mermaid are
 * assumed already settled by the time this is called.
 */
const isKatexRoot = (node: Node): boolean =>
  node.nodeType === Node.ELEMENT_NODE &&
  (node as Element).classList.contains('katex');

/**
 * Walks the DOM manually (rather than via `TreeWalker`) so subtree skipping and text
 * collection stay simple and portable across DOM implementations (jsdom/happy-dom/browser).
 */
const walkTextNodes = (
  node: Node,
  onTextNode: (textNode: Text) => void,
): void => {
  if (isKatexRoot(node)) {
    return;
  }
  if (node.nodeType === Node.TEXT_NODE) {
    onTextNode(node as Text);
    return;
  }
  for (const child of Array.from(node.childNodes)) {
    walkTextNodes(child, onTextNode);
  }
};

const collectTextNodeSpans = (
  container: HTMLElement,
): { spans: TextNodeSpan[]; text: string } => {
  const spans: TextNodeSpan[] = [];
  let text = '';

  walkTextNodes(container, (textNode) => {
    const value = textNode.nodeValue ?? '';
    spans.push({
      node: textNode,
      start: text.length,
      end: text.length + value.length,
    });
    text += value;
  });

  return { spans, text };
};

const resolveDomPositionFrom = (
  spans: TextNodeSpan[],
  text: string,
  textOffset: number,
): { node: Node; offset: number } | null => {
  if (textOffset < 0 || textOffset > text.length || spans.length === 0) {
    return null;
  }

  // An offset at the very end of the text is valid (e.g. for a collapsed selection
  // range at the tail) and resolves to the end of the last text node.
  if (textOffset === text.length) {
    const last = spans[spans.length - 1];
    return { node: last.node, offset: last.end - last.start };
  }

  const span = spans.find(
    (candidate) => textOffset >= candidate.start && textOffset < candidate.end,
  );
  return span == null
    ? null
    : { node: span.node, offset: textOffset - span.start };
};

export const renderedTextOf = (container: HTMLElement): RenderedText => {
  const { spans, text } = collectTextNodeSpans(container);

  return {
    text,
    resolveDomPosition: (textOffset) =>
      resolveDomPositionFrom(spans, text, textOffset),
  };
};
