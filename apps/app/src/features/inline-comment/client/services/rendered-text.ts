/**
 * The plain text extracted from a rendered container, plus a way to map an offset
 * into that text back to a DOM position (a text node + an offset within it).
 */
export interface RenderedText {
  /**
   * Plain text excluding `.katex` subtrees and any subtree rooted at an element with
   * `aria-hidden="true"`. lsx/drawio/mermaid output IS included: this is meant to be
   * built after those widgets have settled, so their content is already resolved and
   * part of the normal DOM text.
   */
  text: string;
  /** Maps an offset into `text` back to a DOM position, or `null` if out of bounds. */
  resolveDomPosition: (
    textOffset: number,
  ) => { node: Node; offset: number } | null;
  /**
   * Converts a DOM boundary point — the same kind of boundary that
   * `Range.setEnd(node, offset)` refers to — into an offset into `text`, using the
   * same exclusion condition and the same traversal order that built `text`. When the
   * boundary point sits inside an excluded subtree, the length up to just before that
   * subtree is returned.
   */
  textOffsetOf: (node: Node, offset: number) => number;
}

/** One text node's contribution to the constructed plain text, as a [start, end) span. */
interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
}

/**
 * An element is excluded from the extracted plain text when either:
 * - it is a KaTeX root (`.katex`): KaTeX renders both an accessibility-only
 *   `.katex-mathml` tree and a visual `.katex-html` tree underneath it, and reading
 *   `textContent` naively would duplicate (and garble) the formula text; or
 * - it carries `aria-hidden="true"`: a declarative marker meaning "decorative, not
 *   part of the content" (e.g. a heading's edit-button icon span, which renders its
 *   Material Symbols ligature name as literal text and whose visibility toggles with
 *   unrelated client-side state such as collaborative-editing load progress).
 *
 * The exclusion knowledge intentionally lives here rather than being expressed as a
 * hardcoded list of element/selector names: any component can opt an element out of
 * the extracted text merely by adding the standard `aria-hidden="true"` attribute,
 * with no dependency on this module. The check looks only at the element itself, not
 * its ancestors — the marker is expected to be set directly on the element to exclude.
 *
 * No other element is excluded: code blocks render synchronously, and lsx/drawio/mermaid
 * are assumed already settled by the time this is called.
 */
const isExcludedRoot = (node: Node): boolean => {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const element = node as Element;
  return (
    element.classList.contains('katex') ||
    element.getAttribute('aria-hidden') === 'true'
  );
};

/**
 * Walks the DOM manually (rather than via `TreeWalker`) so subtree skipping and text
 * collection stay simple and portable across DOM implementations (jsdom/happy-dom/browser).
 */
const walkTextNodes = (
  node: Node,
  onTextNode: (textNode: Text) => void,
): void => {
  if (isExcludedRoot(node)) {
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

/**
 * Counts the characters `text` would have contained for everything preceding the given
 * boundary point, by cloning the container's prefix up to that point and running it
 * through `walkTextNodes` — the very same traversal (and therefore the very same
 * exclusion condition) that built `text`, so the two directions cannot drift apart.
 *
 * A partially selected excluded element is cloned along with its attributes, so
 * `isExcludedRoot` still rejects it and a boundary inside such a subtree naturally
 * yields the length up to just before it.
 */
const textOffsetOfBoundary = (
  container: HTMLElement,
  node: Node,
  offset: number,
): number => {
  const prefixRange = container.ownerDocument.createRange();
  prefixRange.setStart(container, 0);
  prefixRange.setEnd(node, offset);

  let length = 0;
  walkTextNodes(prefixRange.cloneContents(), (textNode) => {
    length += (textNode.nodeValue ?? '').length;
  });

  return length;
};

export const renderedTextOf = (container: HTMLElement): RenderedText => {
  const { spans, text } = collectTextNodeSpans(container);

  return {
    text,
    resolveDomPosition: (textOffset) =>
      resolveDomPositionFrom(spans, text, textOffset),
    textOffsetOf: (node, offset) =>
      textOffsetOfBoundary(container, node, offset),
  };
};
