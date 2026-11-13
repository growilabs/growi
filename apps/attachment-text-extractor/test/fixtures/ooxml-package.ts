import type { ZipEntry } from './zip';

// Building blocks shared by the DOCX / XLSX / PPTX generators. Each generator
// returns its parts as a list so a crafted variant can replace one part and
// zip the list again (the Node counterpart of Python's `_rewrite_zip_member`).

export type OoxmlPart = ZipEntry;

export interface Relationship {
  readonly id: string;
  /** Last segment of an officeDocument relationship type, e.g. `worksheet`. */
  readonly type: string;
  readonly target: string;
}

export interface ContentTypes {
  readonly defaults?: readonly (readonly [extension: string, type: string])[];
  readonly overrides: readonly (readonly [partName: string, type: string])[];
}

export const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const DRAWINGML_NS =
  'http://schemas.openxmlformats.org/drawingml/2006/main';

export const relationshipsXml = (
  relationships: readonly Relationship[],
): string => {
  const items = relationships
    .map(
      ({ id, type, target }) =>
        `<Relationship Id="${id}" Type="${RELATIONSHIPS_NS}/${type}" Target="${target}"/>`,
    )
    .join('');
  return `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
};

export const contentTypesXml = ({
  defaults = [],
  overrides,
}: ContentTypes): string => {
  const defaultItems = [
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
    ...defaults,
  ]
    .map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`)
    .join('');
  const overrideItems = overrides
    .map(
      ([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`,
    )
    .join('');
  return `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaultItems}${overrideItems}</Types>`;
};

/** `_rels/.rels` pointing the package at its main part. */
export const packageRelationshipsPart = (mainPart: string): OoxmlPart => ({
  name: '_rels/.rels',
  data: relationshipsXml([
    { id: 'rId1', type: 'officeDocument', target: mainPart },
  ]),
});

const partText = (part: OoxmlPart): string =>
  typeof part.data === 'string'
    ? part.data
    : Buffer.from(part.data).toString('utf8');

/**
 * Returns the parts with the named part's text rewritten. A missing part
 * throws, so a crafted variant can never silently equal the original.
 */
export const editPart = (
  parts: readonly OoxmlPart[],
  name: string,
  edit: (text: string) => string,
): OoxmlPart[] => {
  if (!parts.some((part) => part.name === name)) {
    throw new Error(`no part named ${name}`);
  }
  return parts.map((part) =>
    part.name === name ? { ...part, data: edit(partText(part)) } : part,
  );
};

/**
 * `String.prototype.replace` that throws when nothing matches: a rewrite that
 * misses leaves the input unchanged and the test checking nothing
 * (research.md 9.5.4).
 */
export const replaceOrThrow = (
  text: string,
  pattern: string | RegExp,
  replacement: string,
): string => {
  const replaced = text.replace(pattern, replacement);
  if (replaced === text) {
    throw new Error(`pattern ${String(pattern)} did not match`);
  }
  return replaced;
};
