import { GROWI_DECORATION_ATTR } from '@growi/core/dist/consts';

/**
 * The plain text extracted from a rendered container, plus a way to map an offset
 * into that text back to a DOM position (a text node + an offset within it).
 */
export interface RenderedText {
  /**
   * Plain text excluding `.katex` subtrees and any subtree rooted at an element with
   * `aria-hidden="true"`. Each `<img>` counts as one `IMAGE_TOKEN`, so an image has
   * a position of its own and a selection of only an image is not empty.
   * lsx/drawio/mermaid output IS included: this is meant to be built after those
   * widgets have settled, so their content is already resolved and part of the
   * normal DOM text.
   */
  text: string;
  /**
   * Maps an offset into `text` back to a DOM position, or `null` if out of bounds.
   *
   * An offset on the border of two text nodes has two DOM positions: the end of
   * the earlier node and the start of the later one. Anything between them that
   * adds no characters to `text` (a `<video>`, an `<svg>`) lies inside a Range
   * that uses the wrong one, so the start of a Range takes the later node
   * (`'start'`, the default) and the end takes the earlier node (`'end'`).
   */
  resolveDomPosition: (
    textOffset: number,
    bias?: BoundaryBias,
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

export type BoundaryBias = 'start' | 'end';

/** U+FFFC OBJECT REPLACEMENT CHARACTER: the Unicode stand-in for an embedded object. */
export const IMAGE_TOKEN = '\uFFFC';

/** A node that contributes characters to the extracted plain text. */
type TextUnit = Text | HTMLImageElement;

/** One unit's contribution to the constructed plain text, as a [start, end) span. */
interface TextUnitSpan {
  node: TextUnit;
  start: number;
  end: number;
}

const isImage = (node: Node): node is HTMLImageElement =>
  node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'IMG';

const textOfUnit = (unit: TextUnit): string =>
  isImage(unit) ? IMAGE_TOKEN : (unit.nodeValue ?? '');

/**
 * An element is excluded from the extracted plain text when any of:
 * - it is a KaTeX root (`.katex`): KaTeX renders both an accessibility-only
 *   `.katex-mathml` tree and a visual `.katex-html` tree underneath it, and reading
 *   `textContent` naively would duplicate (and garble) the formula text; or
 * - it carries `aria-hidden="true"`: a declarative marker meaning "decorative, not
 *   part of the content" (e.g. a heading's edit-button icon span, which renders its
 *   Material Symbols ligature name as literal text and whose visibility toggles with
 *   unrelated client-side state such as collaborative-editing load progress); or
 * - it carries `GROWI_DECORATION_ATTR`: interface decoration that stays visible
 *   and available to assistive technology, but is not authored content (e.g. an
 *   attachment card's icon or its uploader's avatar, which is a focusable link
 *   and so must not be `aria-hidden`).
 *
 * The exclusion knowledge intentionally lives here rather than being expressed as a
 * hardcoded list of element/selector names: any component can opt an element out of
 * the extracted text merely by adding one of these attributes, with no dependency
 * on this module. The check looks only at the element itself, not
 * its ancestors — the marker is expected to be set directly on the element to exclude.
 *
 * No other element is excluded: code blocks render synchronously, and lsx/drawio/mermaid
 * are assumed already settled by the time this is called. Images are not excluded either:
 * each one is collected as a unit of its own (see `IMAGE_TOKEN`).
 */
const isExcludedRoot = (node: Node): boolean => {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  const element = node as Element;
  return (
    element.classList.contains('katex') ||
    element.getAttribute('aria-hidden') === 'true' ||
    element.hasAttribute(GROWI_DECORATION_ATTR)
  );
};

/**
 * Whether `renderedTextOf(container)` counts `image` as an `IMAGE_TOKEN`: it
 * lies inside `container` and neither it nor any ancestor up to `container`
 * is excluded. Anything that offers a comment on an image must ask this, or
 * it could produce a comment whose quote has no character for the image.
 */
export const isCountedImage = (
  image: Element,
  container: HTMLElement,
): image is HTMLImageElement => {
  if (!isImage(image) || !container.contains(image)) {
    return false;
  }
  for (
    let node: Node | null = image;
    node != null && node !== container.parentNode;
    node = node.parentNode
  ) {
    if (isExcludedRoot(node)) {
      return false;
    }
  }
  return true;
};

/**
 * Walks the DOM manually (rather than via `TreeWalker`) so subtree skipping and text
 * collection stay simple and portable across DOM implementations (jsdom/happy-dom/browser).
 */
const walkTextUnits = (
  node: Node,
  onTextUnit: (unit: TextUnit) => void,
): void => {
  if (isExcludedRoot(node)) {
    return;
  }
  if (node.nodeType === Node.TEXT_NODE || isImage(node)) {
    onTextUnit(node as TextUnit);
    return;
  }
  for (const child of Array.from(node.childNodes)) {
    walkTextUnits(child, onTextUnit);
  }
};

const collectTextUnitSpans = (
  container: HTMLElement,
): { spans: TextUnitSpan[]; text: string } => {
  const spans: TextUnitSpan[] = [];
  let text = '';

  walkTextUnits(container, (unit) => {
    const value = textOfUnit(unit);
    spans.push({
      node: unit,
      start: text.length,
      end: text.length + value.length,
    });
    text += value;
  });

  return { spans, text };
};

/**
 * The DOM position `offsetInSpan` characters into `span`. An image has no
 * inside to point into, so its two sides are addressed from its parent.
 */
const domPositionInSpan = (
  span: TextUnitSpan,
  offsetInSpan: number,
): { node: Node; offset: number } => {
  const { node } = span;
  const parent = node.parentNode;
  if (!isImage(node) || parent == null) {
    return { node, offset: offsetInSpan };
  }
  const index = Array.prototype.indexOf.call(parent.childNodes, node);
  return { node: parent, offset: index + offsetInSpan };
};

const resolveDomPositionFrom = (
  spans: TextUnitSpan[],
  text: string,
  textOffset: number,
  bias: BoundaryBias,
): { node: Node; offset: number } | null => {
  if (textOffset < 0 || textOffset > text.length || spans.length === 0) {
    return null;
  }

  // An offset at the very end of the text is valid (e.g. for a collapsed selection
  // range at the tail) and resolves to the end of the last text node.
  if (textOffset === text.length) {
    const last = spans[spans.length - 1];
    return domPositionInSpan(last, last.end - last.start);
  }

  const endingHere =
    bias === 'end'
      ? spans.find(
          (candidate) =>
            textOffset > candidate.start && textOffset <= candidate.end,
        )
      : undefined;
  const span =
    endingHere ??
    spans.find(
      (candidate) =>
        textOffset >= candidate.start && textOffset < candidate.end,
    );
  return span == null ? null : domPositionInSpan(span, textOffset - span.start);
};

/**
 * Counts the characters `text` would have contained for everything preceding the given
 * boundary point, by cloning the container's prefix up to that point and running it
 * through `walkTextUnits` — the very same traversal (and therefore the very same
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
  walkTextUnits(prefixRange.cloneContents(), (unit) => {
    length += textOfUnit(unit).length;
  });

  return length;
};

export const renderedTextOf = (container: HTMLElement): RenderedText => {
  const { spans, text } = collectTextUnitSpans(container);

  return {
    text,
    resolveDomPosition: (textOffset, bias = 'start') =>
      resolveDomPositionFrom(spans, text, textOffset, bias),
    textOffsetOf: (node, offset) =>
      textOffsetOfBoundary(container, node, offset),
  };
};
