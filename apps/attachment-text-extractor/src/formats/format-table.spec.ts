import {
  type AnydocFormat,
  type ResolvedFormat,
  type Route,
  resolveFormat,
  type TextKind,
} from './format-table';

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type Row = readonly [
  mime: string,
  extension: string,
  route: Route,
  anydocFormat: AnydocFormat | null,
  textKind: TextKind | null,
];

// Written out from the target spec's design.md §FormatResolver, known limits included.
const ROWS: readonly Row[] = [
  ['application/pdf', 'pdf', 'pdf', null, null],
  [PPTX_MIME, 'pptx', 'pptx', 'pptx', null],
  [XLSX_MIME, 'xlsx', 'xlsx', 'xlsx', null],
  [DOCX_MIME, 'docx', 'office', 'docx', null],
  ['application/rtf', 'rtf', 'office', 'rtf', null],
  ['application/epub+zip', 'epub', 'office', 'epub', null],
  ['application/msword', 'doc', 'office', 'doc', null],
  ['application/vnd.ms-powerpoint', 'ppt', 'office', 'ppt', null],
  ['application/vnd.ms-excel', 'xls', 'office', 'xlsx', null],
  ['application/vnd.oasis.opendocument.text', 'odt', 'office', 'odt', null],
  [
    'application/vnd.oasis.opendocument.spreadsheet',
    'ods',
    'office',
    'ods',
    null,
  ],
  [
    'application/vnd.oasis.opendocument.presentation',
    'odp',
    'office',
    'odp',
    null,
  ],
  ['text/csv', 'csv', 'text', 'csv', 'csv'],
  ['text/tab-separated-values', 'tsv', 'text', 'csv', 'csv'],
  ['text/html', 'html', 'text', null, 'html'],
  ['text/html', 'htm', 'text', null, 'html'],
  ['text/xml', 'xml', 'text', null, 'xml'],
  ['application/xml', 'xml', 'text', null, 'xml'],
  ['application/x-ipynb+json', 'ipynb', 'text', null, 'ipynb'],
  ['text/plain', 'txt', 'text', null, 'plain'],
  ['text/plain', 'log', 'text', null, 'plain'],
  ['text/markdown', 'md', 'text', null, 'plain'],
  ['application/json', 'json', 'text', null, 'plain'],
  ['text/yaml', 'yaml', 'text', null, 'plain'],
  ['text/yaml', 'yml', 'text', null, 'plain'],
];

const resolved = (
  fileName: string,
  mimeHint: string | null,
): ResolvedFormat => {
  const format = resolveFormat(fileName, mimeHint);
  if (format == null) {
    throw new Error(`expected ${fileName} / ${mimeHint} to be supported`);
  }
  return format;
};

interface Case {
  readonly mime: string;
  readonly extension: string;
  readonly expected: Pick<
    ResolvedFormat,
    'route' | 'anydocFormat' | 'textKind'
  >;
}

const CASES: readonly Case[] = ROWS.map(
  ([mime, extension, route, anydocFormat, textKind]) => ({
    mime,
    extension,
    expected: { route, anydocFormat, textKind },
  }),
);

describe('resolveFormat', () => {
  // MIME-only entries of the Python table (formats.py); no extension maps to them.
  it.each([
    'application/yaml',
    'application/x-yaml',
  ])('the MIME hint %s alone resolves to plain text under its own MIME', (mime) => {
    expect(resolved('no-extension-here', mime)).toEqual({
      mimeType: mime,
      route: 'text',
      anydocFormat: null,
      textKind: 'plain',
    });
  });

  it.each(CASES)('the MIME hint $mime alone decides the route and format', ({
    mime,
    expected,
  }) => {
    expect(resolved('no-extension-here', mime)).toMatchObject(expected);
  });

  it.each(
    CASES,
  )('the extension .$extension alone decides the route and format', ({
    extension,
    expected,
  }) => {
    expect(resolved(`report.${extension}`, null)).toMatchObject(expected);
  });

  it.each(CASES)('the extension .$extension is case-insensitive', ({
    extension,
    expected,
  }) => {
    expect(resolved(`REPORT.${extension.toUpperCase()}`, null)).toMatchObject(
      expected,
    );
  });

  it.each(
    CASES,
  )('the MIME hint $mime is case-insensitive and reported in lower case', ({
    mime,
    expected,
  }) => {
    const format = resolved('x', mime.toUpperCase());

    expect(format.route).toBe(expected.route);
    expect(format.mimeType).toBe(mime);
  });

  it('passes XLS to anydoc under the format name xlsx', () => {
    expect(resolved('old.xls', null)).toMatchObject({
      route: 'office',
      anydocFormat: 'xlsx',
    });
  });

  it.each([
    'text/plain; charset=utf-8',
    'text/plain;charset=Shift_JIS',
    'TEXT/PLAIN ; charset=utf-8',
  ])('ignores the MIME parameters of %j', (mime) => {
    expect(resolveFormat('a.bin', mime)).toEqual({
      mimeType: 'text/plain',
      route: 'text',
      anydocFormat: null,
      textKind: 'plain',
    });
  });

  it.each([
    'application/octet-stream',
    'binary/octet-stream',
    'application/x-unknown',
    '',
    '   ',
  ])('falls back to the extension for the generic or unknown MIME %j', (mime) => {
    const format = resolved('slides.pptx', mime);

    expect(format.route).toBe('pptx');
    expect(format.mimeType).toBe(PPTX_MIME);
  });

  it('lets a MIME hint in the table win over a conflicting extension', () => {
    const format = resolved('misnamed.docx', 'application/pdf');

    expect(format.route).toBe('pdf');
    expect(format.mimeType).toBe('application/pdf');
  });

  it('reads the extension after the last dot when the MIME hint is null', () => {
    expect(resolved('v1.2.final.pdf', null).route).toBe('pdf');
  });

  // Outlook MSG is deliberately absent from the table (target spec Req 1.6).
  it.each([
    ['mail.msg', 'application/vnd.ms-outlook'],
    ['mail.msg', null],
    ['mail.MSG', 'application/octet-stream'],
    ['archive.zip', null],
    ['noextension', null],
    ['noextension', 'application/octet-stream'],
    ['trailingdot.', null],
    ['image.png', 'image/png'],
  ])('reports %s with MIME %j as unsupported', (fileName, mime) => {
    expect(resolveFormat(fileName, mime)).toBeNull();
  });
});
