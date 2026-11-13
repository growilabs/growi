import type { Element, Node } from '@xmldom/xmldom';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const ELEMENT_NODE = 1;

export const isElement = (node: Node): node is Element =>
  node.nodeType === ELEMENT_NODE;

/** Child elements, optionally only those with the given local name (any prefix). */
export const childElements = (
  parent: Node | null | undefined,
  localName?: string,
): Element[] =>
  Array.from(parent?.childNodes ?? []).filter(
    (node): node is Element =>
      isElement(node) && (localName == null || node.localName === localName),
  );

export const firstChildElement = (
  parent: Node | null | undefined,
  localName: string,
): Element | undefined => childElements(parent, localName)[0];

// A prefix may not be bound to the empty namespace (Namespaces in XML 1.0).
const isDeclarationError = (name: string, value: string): boolean =>
  name === 'xmlns:xmlns' ||
  (name.startsWith('xmlns:') && value === '') ||
  value === XMLNS_NS ||
  (name === 'xmlns:xml') !== (value === XML_NS);

const hasAttributeError = (element: Element): boolean => {
  const seen = new Set<string>();
  for (const attribute of Array.from(element.attributes)) {
    const { name, value } = attribute;
    if (name === 'xmlns' || name.startsWith('xmlns:')) {
      if (isDeclarationError(name, value)) {
        return true;
      }
      continue;
    }
    const key = `${attribute.namespaceURI ?? ''} ${attribute.localName}`;
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
};

/** Namespace rules expat enforces and xmldom does not: reserved prefixes and repeated expanded attribute names. */
export const hasNamespaceError = (root: Element): boolean => {
  const pending = [root];
  for (let element = pending.pop(); element != null; element = pending.pop()) {
    if (hasAttributeError(element)) {
      return true;
    }
    // Not push(...children): spreading 100k+ siblings overflows the stack.
    for (const child of childElements(element)) {
      pending.push(child);
    }
  }
  return false;
};
