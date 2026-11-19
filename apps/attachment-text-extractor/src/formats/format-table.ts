export type Route = 'pdf' | 'pptx' | 'xlsx' | 'office' | 'text';

export type AnydocFormat =
  | 'doc'
  | 'docx'
  | 'odt'
  | 'ppt'
  | 'pptx'
  | 'rtf'
  | 'epub'
  | 'xlsx'
  | 'ods'
  | 'odp'
  | 'csv';

export type TextKind = 'plain' | 'html' | 'xml' | 'ipynb' | 'csv';

export interface ResolvedFormat {
  readonly route: Route;
  readonly mimeType: string;
  readonly anydocFormat: AnydocFormat | null;
  readonly textKind: TextKind | null;
}

type TableRow = readonly [
  mimeType: string,
  route: Route,
  anydocFormat: AnydocFormat | null,
  textKind: TextKind | null,
  /** File extensions that resolve to this row; empty for a row reachable by MIME hint only. */
  extensions: readonly string[],
];

// Outlook MSG is deliberately absent: it must stay unsupported.
const TABLE: readonly TableRow[] = [
  ['application/pdf', 'pdf', null, null, ['pdf']],
  [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'pptx',
    'pptx',
    null,
    ['pptx'],
  ],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xlsx',
    'xlsx',
    null,
    ['xlsx'],
  ],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'office',
    'docx',
    null,
    ['docx'],
  ],
  ['application/rtf', 'office', 'rtf', null, ['rtf']],
  ['application/epub+zip', 'office', 'epub', null, ['epub']],
  ['application/msword', 'office', 'doc', null, ['doc']],
  ['application/vnd.ms-powerpoint', 'office', 'ppt', null, ['ppt']],
  // anydoc handles legacy XLS under the format name "xlsx".
  ['application/vnd.ms-excel', 'office', 'xlsx', null, ['xls']],
  ['application/vnd.oasis.opendocument.text', 'office', 'odt', null, ['odt']],
  [
    'application/vnd.oasis.opendocument.spreadsheet',
    'office',
    'ods',
    null,
    ['ods'],
  ],
  [
    'application/vnd.oasis.opendocument.presentation',
    'office',
    'odp',
    null,
    ['odp'],
  ],
  ['text/csv', 'text', 'csv', 'csv', ['csv']],
  ['text/tab-separated-values', 'text', 'csv', 'csv', ['tsv']],
  ['text/html', 'text', null, 'html', ['html', 'htm']],
  ['text/xml', 'text', null, 'xml', ['xml']],
  ['application/xml', 'text', null, 'xml', []],
  ['application/x-ipynb+json', 'text', null, 'ipynb', ['ipynb']],
  ['text/plain', 'text', null, 'plain', ['txt', 'log']],
  ['text/markdown', 'text', null, 'plain', ['md']],
  ['application/json', 'text', null, 'plain', ['json']],
  ['text/yaml', 'text', null, 'plain', ['yaml', 'yml']],
  ['application/yaml', 'text', null, 'plain', []],
  ['application/x-yaml', 'text', null, 'plain', []],
];

const formatOf = ([
  mimeType,
  route,
  anydocFormat,
  textKind,
]: TableRow): ResolvedFormat => ({
  mimeType,
  route,
  anydocFormat,
  textKind,
});

const RESOLVED = TABLE.map((tableRow) => ({
  format: formatOf(tableRow),
  extensions: tableRow[4],
}));

// Map, not a plain object: a hint or extension such as "constructor" must not hit the prototype.
const BY_MIME: ReadonlyMap<string, ResolvedFormat> = new Map(
  RESOLVED.map(({ format }) => [format.mimeType, format]),
);

const BY_EXTENSION: ReadonlyMap<string, ResolvedFormat> = new Map(
  RESOLVED.flatMap(({ format, extensions }) =>
    extensions.map((extension): [string, ResolvedFormat] => [
      extension,
      format,
    ]),
  ),
);

const lookupMime = (mimeHint: string | null): ResolvedFormat | undefined => {
  if (mimeHint == null) {
    return undefined;
  }
  // Parameters such as "; charset=utf-8" are not part of the media type.
  const mediaType = mimeHint.split(';', 1)[0].trim().toLowerCase();
  return BY_MIME.get(mediaType);
};

const lookupExtension = (fileName: string): ResolvedFormat | undefined => {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) {
    return undefined;
  }
  return BY_EXTENSION.get(
    fileName
      .slice(dot + 1)
      .trim()
      .toLowerCase(),
  );
};

/** A MIME hint found in the table wins; otherwise the extension decides. null means unsupported. */
export const resolveFormat = (
  fileName: string,
  mimeHint: string | null,
): ResolvedFormat | null =>
  lookupMime(mimeHint) ?? lookupExtension(fileName) ?? null;
