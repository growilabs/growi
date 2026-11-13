import type { Document, Element } from '@xmldom/xmldom';

import { childElements } from './dom-elements';
import { unquote } from './percent-decode';
import { quoteAttribute, xmlDocument } from './xml-attribute';

const CONTENT_TYPES_NS =
  'http://schemas.openxmlformats.org/package/2006/content-types';

interface Item {
  readonly position: number;
  readonly xml: string;
}

/** [Content_Types].xml read once; each package then costs only its own parts. */
export interface ContentTypes {
  /** The part for a package of these part names: every Default, and the Overrides of these parts, in document order. */
  forParts(parts: Iterable<string>): Buffer;
}

const quoted = (node: Element, name: string): string =>
  quoteAttribute(node.getAttribute(name) ?? '');

const overrideKey = (node: Element): string =>
  unquote(node.getAttribute('PartName') ?? '')
    .replace(/^\/+/, '')
    .toLowerCase();

/** Two lists sorted by position, merged. */
const merged = (a: readonly Item[], b: readonly Item[]): string => {
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const takeA =
      j >= b.length || (i < a.length && a[i].position < b[j].position);
    out.push(takeA ? a[i++].xml : b[j++].xml);
  }
  return out.join('');
};

export const indexContentTypes = (document: Document): ContentTypes => {
  const defaults: Item[] = [];
  const overrides = new Map<string, Item[]>();
  childElements(document.documentElement).forEach((node, position) => {
    if (node.localName === 'Default') {
      const xml = `<Default Extension=${quoted(node, 'Extension')} ContentType=${quoted(node, 'ContentType')}/>`;
      defaults.push({ position, xml });
    } else if (node.localName === 'Override') {
      const xml = `<Override PartName=${quoted(node, 'PartName')} ContentType=${quoted(node, 'ContentType')}/>`;
      const key = overrideKey(node);
      const items = overrides.get(key) ?? [];
      items.push({ position, xml });
      overrides.set(key, items);
    }
  });
  return {
    forParts: (parts) => {
      const keys = new Set(Array.from(parts, (part) => part.toLowerCase()));
      const selected = [...keys]
        .flatMap((key) => overrides.get(key) ?? [])
        .sort((a, b) => a.position - b.position);
      return xmlDocument(
        `<Types xmlns="${CONTENT_TYPES_NS}">${merged(defaults, selected)}</Types>`,
      );
    },
  };
};
