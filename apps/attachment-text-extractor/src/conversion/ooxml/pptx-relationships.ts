import type { Element } from '@xmldom/xmldom';

import { childElements } from './dom-elements';
import { unquote } from './percent-decode';
import { basename, dirname, join, normpath } from './posix-path';
import { parseXmlPart } from './safe-xml';
import { quoteAttribute, xmlDocument } from './xml-attribute';

export const CONTENT_TYPES = '[Content_Types].xml';
const RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/package/2006/relationships';
// Both the transitional and the Strict OOXML relationship namespaces end so.
const SLIDE_TYPE_SUFFIX = '/slide';
const ID_NAMESPACE_SUFFIX = 'relationships';

export interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
  /** The part inside the archive it reaches, or null when it is unusable. */
  readonly part: string | null;
}

export const isSlide = (relationship: Relationship): boolean =>
  relationship.type.endsWith(SLIDE_TYPE_SUFFIX);

/** "dir/name.xml" -> "dir/_rels/name.xml.rels"; "" (the package root) -> "_rels/.rels". */
export const relationshipsPartOf = (part: string): string =>
  join(dirname(part), '_rels', `${basename(part)}.rels`);

/** The archive name of an internal XML target, or null if it leaves the package or is absent. */
export const resolveTarget = (
  names: ReadonlySet<string>,
  source: string,
  target: string,
): string | null => {
  const path = unquote(target.split('#', 1)[0]);
  if (path === '') {
    return null;
  }
  const joined = path.startsWith('/')
    ? path.replace(/^\/+/, '')
    : join(dirname(source), path);
  const name = normpath(joined);
  if (
    name === '.' ||
    name === '..' ||
    name.startsWith('../') ||
    name.startsWith('/')
  ) {
    return null;
  }
  // [Content_Types].xml is rebuilt per package, never copied in as a part.
  return name !== CONTENT_TYPES &&
    name.toLowerCase().endsWith('.xml') &&
    names.has(name)
    ? name
    : null;
};

const attribute = (element: Element, name: string, fallback: string): string =>
  element.getAttribute(name) ?? fallback;

export const parseRelationships = (
  raw: Uint8Array,
  names: ReadonlySet<string>,
  source: string,
): Relationship[] =>
  childElements(
    parseXmlPart(raw, 'PPTX part').documentElement,
    'Relationship',
  ).map((node) => {
    const external = attribute(node, 'TargetMode', 'Internal') === 'External';
    const target = attribute(node, 'Target', '');
    return {
      id: attribute(node, 'Id', ''),
      type: attribute(node, 'Type', ''),
      target,
      external,
      part: external ? null : resolveTarget(names, source, target),
    };
  });

/** The slide list entry's r:id, matched on the namespace suffix as the Python service does. */
export const relationshipIdOf = (entry: Element): string | null =>
  Array.from(entry.attributes).find(
    (a) =>
      a.localName === 'id' &&
      (a.namespaceURI ?? '').endsWith(ID_NAMESPACE_SUFFIX),
  )?.value ?? null;

export const serializeRelationship = (relationship: Relationship): string =>
  `<Relationship Id=${quoteAttribute(relationship.id)} Type=${quoteAttribute(relationship.type)} Target=${quoteAttribute(relationship.target)}${relationship.external ? ' TargetMode="External"' : ''}/>`;

export const relationshipsDocument = (items: readonly string[]): Buffer =>
  xmlDocument(
    `<Relationships xmlns="${RELATIONSHIPS_NS}">${items.join('')}</Relationships>`,
  );
