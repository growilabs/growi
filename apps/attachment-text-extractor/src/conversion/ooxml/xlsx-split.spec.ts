import { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc';

import {
  buildDuplicatedEntryXlsx,
  buildEncryptedXlsx,
  buildLargePivotCacheXlsx,
  buildOverCellLimitXlsx,
  buildStaleReferenceXlsx,
  buildStoredEntriesXlsx,
  buildXlsx,
  buildZip,
  editPart,
  PLAIN_DOCUMENTS,
  replaceOrThrow,
  type XlsxSheet,
  xlsxParts,
} from '../../../test/fixtures';
import {
  readZipDirectory,
  readZipEntries,
  readZipText,
} from '../../../test/fixtures/spec-support';
import type { PageInfo } from '../../contract';
import { conversionErrorOf, conversionLimits } from '../spec-support';
import { convertXlsx } from './xlsx-split';

// anydoc is the external boundary: the real converter still runs, and the
// spy only records which package went in and what came out.
vi.mock('@firecrawl/anydoc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@firecrawl/anydoc')>();
  return { ...actual, toMarkdownBytes: vi.fn(actual.toMarkdownBytes) };
});

const MIB = 1024 * 1024;
const WORKBOOK = 'xl/workbook.xml';
const SHEET1 = 'xl/worksheets/sheet1.xml';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XLSX = formatFromExtension('xlsx');

const anydoc = vi.mocked(toMarkdownBytes);

beforeEach(() => {
  anydoc.mockClear();
});

const limits = conversionLimits;

const sentPackages = (): Buffer[] =>
  anydoc.mock.calls.map(([bytes]) => Buffer.from(bytes));

const sentFormats = (): unknown[] =>
  anydoc.mock.calls.map(([, format]) => format);

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

/** One sheet per [name, column A values]; a sheet with no values has no cells. */
const book = (sheets: readonly (readonly [string, readonly string[]])[]) =>
  sheets.map(
    ([name, values]): XlsxSheet => ({
      name,
      rows: values.map((value) => [value]),
    }),
  );

const buildBook = (
  sheets: readonly (readonly [string, readonly string[]])[],
): Buffer => buildXlsx(book(sheets));

const withWorkbook = (
  sheets: readonly XlsxSheet[],
  edit: (xml: string) => string,
): Buffer => buildZip(editPart(xlsxParts(sheets), WORKBOOK, edit));

const swapFirstTwoSheets = (xml: string): string => {
  const sheets = xml.match(/<sheet\b[^>]*\/>/g) ?? [];
  return replaceOrThrow(xml, sheets[0] + sheets[1], sheets[1] + sheets[0]);
};

const sentNames = (pkg: Uint8Array): string[] =>
  [
    ...readZipText(pkg, WORKBOOK).matchAll(
      /<(?:[\w.-]+:)?sheet\b[^>]*?\bname=(["'])(.*?)\1/g,
    ),
  ].map((match) => match[2]);

const labels = (pages: readonly PageInfo[]) =>
  pages.map((page) => [page.pageNumber, page.label]);

/** anydoc's own per-sheet bodies, cut at its "## " headings. */
const sections = (markdown: string): string[] => {
  const [before, ...bodies] = markdown.split(/^## .*\n/m);
  expect(before).toBe('');
  return bodies.map((body) => body.replace(/^\n+|\n+$/g, ''));
};

// anydoc writes "## <sheet name>", a blank line, the table, and one blank line between sheets.
const rejoined = (pages: readonly PageInfo[]): string =>
  `${pages.map((page) => `## ${page.label}\n\n${page.content}`).join('\n\n')}\n`;

const AWKWARD_NAMES = [
  '売上',
  'Summary <#1>',
  'A&B "double" \'single\' >',
  '[draft] a*b:c/d?e\\f',
  'x|y_z*w`~',
  '## looks like a heading',
  'ZZ0123456789abcdef0123456789abcdef1ZZ',
  'ZZ00000000000000000000000000000000002ZZ',
  'abcdefghijklmnopqrstuvwxyz01234',
  '長'.repeat(300),
  'Sheet',
  'Sheet',
  'sheet',
  '📊 データ &amp; literal',
];

const awkwardBook = (): Buffer =>
  buildXlsx(
    AWKWARD_NAMES.map((name, i) => ({
      name,
      rows: [[`value ${i}`], [`row two ${i}`]],
    })),
  );

const plainBook = (): Buffer =>
  buildBook([
    ['売上', ['商品', 'りんご']],
    ['Summary <#1>', ['Total']],
    ['Third', ['3']],
  ]);

const SECRET_NAMES = ['Payroll secret', 'Bonus secret', 'Third secret'];

const secretBook = (): Buffer =>
  buildBook(SECRET_NAMES.map((name, i) => [name, [`cell ${i}`]]));

/** Make anydoc answer with text built from the marker names it was sent. */
const answerWith = (render: (markers: string[]) => string): void => {
  anydoc.mockImplementationOnce(async (bytes) => render(sentNames(bytes)));
};

// Markers end in the 1-based sheet position, so the first one ends in "1ZZ".
const unknownNumber = (marker: string): string => {
  expect(marker.endsWith('1ZZ')).toBe(true);
  return `${marker.slice(0, -'1ZZ'.length)}9ZZ`;
};

describe('sheet names and order survive the markers', () => {
  it('returns awkward sheet names in workbook order', async () => {
    const pages = await convertXlsx(awkwardBook(), limits());

    expect(labels(pages)).toEqual(
      AWKWARD_NAMES.map((name, i) => [i + 1, name]),
    );
    expect(pages.map((page) => page.content.split('value').length - 1)).toEqual(
      AWKWARD_NAMES.map(() => 1),
    );
    expect(pages.every((page, i) => page.content.includes(`value ${i} `))).toBe(
      true,
    );
  });

  it.each([
    ['awkward', awkwardBook],
    ['plain', plainBook],
    ['stale_references', buildStaleReferenceXlsx],
  ])('keeps the sheet bodies anydoc gives the original workbook (%s)', async (_source, build) => {
    const workbook = build();
    const whole = await toMarkdownBytes(workbook, XLSX);

    const pages = await convertXlsx(workbook, limits());

    expect(pages.map((page) => page.content)).toEqual(sections(whole));
  });

  it('rejoins plain names to the original output exactly', async () => {
    const workbook = plainBook();
    const whole = await toMarkdownBytes(workbook, XLSX);

    expect(rejoined(await convertXlsx(workbook, limits()))).toBe(whole);
  });

  it('labels sheets with the stored names, not the escaped headings anydoc writes', async () => {
    const names = ['[draft] a\\b', 'a<b', 'literal &amp; text'];
    const workbook = buildBook(names.map((name, i) => [name, [`v${i}`]]));
    const headings = (await toMarkdownBytes(workbook, XLSX))
      .split('\n')
      .filter((line) => line.startsWith('## '));

    const pages = await convertXlsx(workbook, limits());

    expect(headings).not.toEqual(names.map((name) => `## ${name}`));
    expect(pages.map((page) => page.label)).toEqual(names);
  });

  it('does not rewrite defined names', async () => {
    const pages = await convertXlsx(buildStaleReferenceXlsx(), limits());

    const workbookXml = readZipText(sentPackages()[0], WORKBOOK);
    expect(workbookXml).toContain('Beta!$A$1');
    expect(workbookXml).toContain("'Alpha'!$1:$1");
    expect(pages[0].content).toContain('cached from beta');
  });

  it('skips the empty sheet of the fixture workbook', async () => {
    const pages = await convertXlsx(
      PLAIN_DOCUMENTS.xlsxMultiSheet.build(),
      limits(),
    );

    expect(labels(pages)).toEqual([
      [1, '売上'],
      [2, 'Summary <#1>'],
    ]);
    expect(pages[0].content).toContain('りんご');
    expect(pages[1].content).toContain('Total');
  });

  it('leaves a gap in the numbers for an empty sheet in the middle', async () => {
    const pages = await convertXlsx(
      buildBook([
        ['First', ['one']],
        ['Blank', []],
        ['Third', ['three']],
      ]),
      limits(),
    );

    expect(labels(pages)).toEqual([
      [1, 'First'],
      [3, 'Third'],
    ]);
    expect(pages[1].content).toContain('three');
  });

  it('skips a chart sheet but counts it', async () => {
    const pages = await convertXlsx(
      PLAIN_DOCUMENTS.xlsxChartSheet.build(),
      limits(),
    );

    expect(labels(pages)).toEqual([[1, 'Data']]);
    expect(pages[0].content).toContain('Jan');
  });

  it('shifts the number of a worksheet listed after a chart sheet', async () => {
    const chartFirst = buildZip(
      editPart(
        xlsxParts([
          {
            name: 'Data',
            rows: [
              ['Month', 'Sales'],
              ['Jan', 10],
            ],
          },
          {
            name: 'Chart',
            chart: {
              dataSheet: 'Data',
              categories: '$A$2:$A$2',
              values: '$B$2:$B$2',
            },
          },
        ]),
        WORKBOOK,
        swapFirstTwoSheets,
      ),
    );

    const pages = await convertXlsx(chartFirst, limits());

    expect(labels(pages)).toEqual([[2, 'Data']]);
  });

  it('keeps a hidden sheet at its position', async () => {
    const pages = await convertXlsx(
      PLAIN_DOCUMENTS.xlsxHiddenSheet.build(),
      limits(),
    );

    expect(labels(pages)).toEqual([
      [1, 'Visible'],
      [2, 'Secret'],
    ]);
    expect(pages[1].content).toContain('hidden marker');
  });

  it.each<'hidden' | 'veryHidden'>([
    'hidden',
    'veryHidden',
  ])('makes a %s sheet visible in the package sent to anydoc', async (state) => {
    const workbook = buildXlsx([
      { name: 'Shown', rows: [['shown text']] },
      { name: 'Kept', rows: [['kept text']], state },
    ]);

    const pages = await convertXlsx(workbook, limits());

    expect(labels(pages)).toEqual([
      [1, 'Shown'],
      [2, 'Kept'],
    ]);
    expect(pages[1].content).toContain('kept text');
    expect(readZipText(sentPackages()[0], WORKBOOK)).not.toContain('idden');
  });

  it('follows the sheet order of the workbook, not the sheet ids', async () => {
    const workbook = withWorkbook(
      book([
        ['Low id', ['low']],
        ['High id', ['high']],
      ]),
      swapFirstTwoSheets,
    );

    const pages = await convertXlsx(workbook, limits());

    expect(labels(pages)).toEqual([
      [1, 'High id'],
      [2, 'Low id'],
    ]);
    expect(pages[0].content).toContain('high');
  });

  it('still splits Excel-style workbook markup', async () => {
    // Prefixes named only in mc:Ignorable, AlternateContent and revision attributes, as Excel writes them.
    const excelWorkbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      `<workbook xmlns="${MAIN_NS}" ` +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x15 xr xr6 xr10" ' +
      'xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main" ' +
      'xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" ' +
      'xmlns:xr6="http://schemas.microsoft.com/office/spreadsheetml/2016/revision6" ' +
      'xmlns:xr10="http://schemas.microsoft.com/office/spreadsheetml/2016/revision10">' +
      '<fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27425"/>' +
      '<workbookPr defaultThemeVersion="166925"/>' +
      '<mc:AlternateContent><mc:Choice Requires="x15"><x15ac:absPath url="C:\\Users\\x\\" ' +
      'xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"/></mc:Choice></mc:AlternateContent>' +
      '<xr:revisionPtr revIDLastSave="0" documentId="8_{1}" xr6:coauthVersionLast="47" ' +
      'xr10:uidLastSave="{00000000-0000-0000-0000-000000000000}"/>' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="1" windowHeight="1"/></bookViews>' +
      '<sheets><sheet name="First" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Second" sheetId="2" state="hidden" r:id="rId2"/></sheets>' +
      '<calcPr calcId="191029"/></workbook>';
    const workbook = withWorkbook(
      book([
        ['a', ['first text']],
        ['b', ['second text']],
      ]),
      () => excelWorkbook,
    );

    const pages = await convertXlsx(workbook, limits());

    expect(labels(pages)).toEqual([
      [1, 'First'],
      [2, 'Second'],
    ]);
    expect(pages[1].content).toContain('second text');
  });

  it('keeps cell text shaped like a marker heading in its sheet', async () => {
    const forged = '## ZZ0123456789abcdef0123456789abcdef1ZZ';

    const pages = await convertXlsx(
      buildBook([
        ['One', [forged, 'one']],
        ['Two', ['two']],
      ]),
      limits(),
    );

    expect(labels(pages)).toEqual([
      [1, 'One'],
      [2, 'Two'],
    ]);
    expect(pages[0].content).toContain('ZZ0123456789abcdef0123456789abcdef1ZZ');
  });

  it('still finds a sheet whose name is only whitespace', async () => {
    // anydoc prints no heading for a blank name, which is why every name is replaced.
    const pages = await convertXlsx(
      buildBook([
        ['   ', ['blank named']],
        ['Normal', ['normal']],
      ]),
      limits(),
    );

    expect(labels(pages)).toEqual([
      [1, '   '],
      [2, 'Normal'],
    ]);
    expect(pages[0].content).toContain('blank named');
  });
});

describe('one sheet: anydoc prints no heading', () => {
  it('returns one element named after the only sheet', async () => {
    const pages = await convertXlsx(
      PLAIN_DOCUMENTS.xlsxSingleSheet.build(),
      limits(),
    );

    expect(labels(pages)).toEqual([[1, 'OnlySheet']]);
    expect(pages[0].content).toContain('single sheet marker');
    expect(pages[0].content).not.toContain('##');
  });

  it('still converts a single hidden sheet', async () => {
    const pages = await convertXlsx(
      buildXlsx([{ name: 'Lonely', rows: [['lonely text']], state: 'hidden' }]),
      limits(),
    );

    expect(labels(pages)).toEqual([[1, 'Lonely']]);
    expect(pages[0].content).toContain('lonely text');
  });

  it('keeps an awkward name of a single sheet', async () => {
    const pages = await convertXlsx(
      buildBook([['<&>"\'[]', ['content']]]),
      limits(),
    );

    expect(labels(pages)).toEqual([[1, '<&>"\'[]']]);
  });

  it('returns no elements when every sheet is empty', async () => {
    expect(
      await convertXlsx(
        buildBook([
          ['A', []],
          ['B', []],
        ]),
        limits(),
      ),
    ).toEqual([]);
  });
});

describe('what is handed to anydoc', () => {
  it('calls anydoc once with the xlsx format', async () => {
    await convertXlsx(PLAIN_DOCUMENTS.xlsxMultiSheet.build(), limits());

    expect(sentFormats()).toEqual([XLSX]);
  });

  it('sends alphanumeric marker names unique to each call', async () => {
    const workbook = PLAIN_DOCUMENTS.xlsxMultiSheet.build();

    await convertXlsx(workbook, limits());
    await convertXlsx(workbook, limits());

    const [first, second] = sentPackages().map(sentNames);
    expect(first).toHaveLength(3);
    expect(
      [...first, ...second].every((name) => /^[A-Za-z0-9]+$/.test(name)),
    ).toBe(true);
    expect(new Set(first).size).toBe(3);
    expect(first.filter((name) => second.includes(name))).toEqual([]);
    expect(
      first.filter((name) => ['売上', 'Summary <#1>', 'Empty'].includes(name)),
    ).toEqual([]);
  });

  it('copies the other parts unchanged and in their original order', async () => {
    const workbook = PLAIN_DOCUMENTS.xlsxChartSheet.build();

    await convertXlsx(workbook, limits());

    const before = readZipDirectory(workbook) ?? [];
    const after = readZipDirectory(sentPackages()[0]) ?? [];
    expect(after.map((entry) => entry.name)).toEqual(
      before.map((entry) => entry.name),
    );
    expect(after.map((entry) => entry.method)).toEqual(
      before.map((entry) => entry.method),
    );
    const beforeBodies = readZipEntries(workbook);
    const afterBodies = readZipEntries(sentPackages()[0]);
    for (const [name, body] of beforeBodies) {
      if (name !== WORKBOOK) {
        expect(afterBodies.get(name)?.equals(body)).toBe(true);
      }
    }
  });

  it('sends a duplicated entry once, with the copy anydoc reads', async () => {
    const workbook = buildDuplicatedEntryXlsx();
    const whole = await toMarkdownBytes(workbook, XLSX);
    anydoc.mockClear();

    const pages = await convertXlsx(workbook, limits());

    expect(pages.map((page) => page.content)).toEqual(sections(whole));
    expect(pages[0].content).toContain('second copy');
    expect(
      (readZipDirectory(sentPackages()[0]) ?? []).filter(
        (entry) => entry.name === SHEET1,
      ),
    ).toHaveLength(1);
  });

  it('repackages a large unreferenced part without growing the package', async () => {
    // Pivot cache records and media are not counted as cells, so only streaming keeps them cheap.
    const workbook = buildLargePivotCacheXlsx(
      book([
        ['A', ['a']],
        ['B', ['b']],
      ]),
    );
    expect(workbook.length).toBeLessThan(MIB);
    anydoc.mockResolvedValueOnce('');

    await convertXlsx(workbook, limits());

    expect(sentPackages()).toHaveLength(1);
    expect(sentPackages()[0].length).toBeLessThan(2 * MIB);
  }, 60_000);

  it('keeps stored entries stored', async () => {
    const pages = await convertXlsx(buildStoredEntriesXlsx(), limits());

    expect(labels(pages)).toEqual([
      [1, 'A'],
      [2, 'B'],
    ]);
    expect(
      new Set(
        (readZipDirectory(sentPackages()[0]) ?? []).map(
          (entry) => entry.method,
        ),
      ),
    ).toEqual(new Set([0]));
  });
});

describe('whole-output fallback: only for output the markers cannot explain', () => {
  it.each([
    [
      'text before the first marker',
      (m: string[]) => `stray\n\n## ${m[0]}\n\nA\n\n## ${m[1]}\n\nB\n`,
    ],
    ['order mismatch', (m: string[]) => `## ${m[1]}\n\nB\n\n## ${m[0]}\n\nA\n`],
    [
      'marker repeated',
      (m: string[]) => `## ${m[0]}\n\nA\n\n## ${m[0]}\n\nB\n`,
    ],
    [
      'unknown marker number',
      (m: string[]) => `## ${m[0]}\n\nA\n\n## ${unknownNumber(m[0])}\n\nC\n`,
    ],
    [
      'marker outside a heading',
      (m: string[]) => `## ${m[0]}\n\nA mentions ${m[1]}\n\n## ${m[1]}\n\nB\n`,
    ],
    [
      'marker inside a longer heading',
      (m: string[]) => `## ${m[0]}\n\nA\n\n## ${m[1]} extra\n\nB\n`,
    ],
    ['no marker at all', () => '| a |\n| --- |\n| b |\n'],
  ])('falls back to one unnumbered element (%s)', async (_case, render) => {
    answerWith(render);

    const pages = await convertXlsx(secretBook(), limits());

    expect(pages).toHaveLength(1);
    expect([pages[0].pageNumber, pages[0].label]).toEqual([null, null]);
    expect(pages[0].content).not.toContain('ZZ');
  });

  it('restores the sheet names in the fallback text', async () => {
    answerWith((m) => `## ${m[1]}\n\nB\n\n## ${m[0]}\n\nA\n`);

    const pages = await convertXlsx(secretBook(), limits());

    expect(pages).toEqual([
      {
        pageNumber: null,
        label: null,
        content: '## Bonus secret\n\nB\n\n## Payroll secret\n\nA\n',
      },
    ]);
  });

  it('does not mistake a marker from another call for a sheet', async () => {
    const foreign = 'ZZ0123456789abcdef0123456789abcdef1ZZ';
    answerWith(
      (m) => `## ${m[0]}\n\nA\n\n## ${foreign}\n\nX\n\n## ${m[1]}\n\nB\n`,
    );

    const pages = await convertXlsx(secretBook(), limits());

    // Not one of this call's markers: it is ordinary text of the first sheet.
    expect(labels(pages)).toEqual([
      [1, 'Payroll secret'],
      [2, 'Bonus secret'],
    ]);
    expect(pages[0].content).toContain(foreign);
  });
});

describe('packages that do not pass the ZIP pre-check go to anydoc whole', () => {
  it('hands a legacy XLS over whole under the xlsx format', async () => {
    const xls = PLAIN_DOCUMENTS.xls.build();

    const pages = await convertXlsx(xls, limits());

    expect(sentPackages()).toHaveLength(1);
    expect(sameBytes(sentPackages()[0], xls)).toBe(true);
    expect(sentFormats()).toEqual([XLSX]);
    expect(pages).toHaveLength(1);
    expect([pages[0].pageNumber, pages[0].label]).toEqual([null, null]);
    expect(pages[0].content).toContain('XLS cell marker');
    expect(pages[0].content).toContain('second sheet');
  });

  it('hands an encrypted XLSX over whole and reports encrypted', async () => {
    const workbook = buildEncryptedXlsx();

    const error = await conversionErrorOf(() =>
      convertXlsx(workbook, limits()),
    );

    expect(error.kind).toBe('encrypted');
    expect(sentPackages()).toHaveLength(1);
    expect(sameBytes(sentPackages()[0], workbook)).toBe(true);
    expect(sentFormats()).toEqual([XLSX]);
  });

  it('hands a ZIP without a workbook over whole', async () => {
    const zip = buildZip([{ name: 'other.xml', data: '<x/>' }]);
    anydoc.mockImplementationOnce(
      async (bytes, format) => `whole ${format} ${bytes.length}`,
    );

    expect(await convertXlsx(zip, limits())).toEqual([
      { pageNumber: null, label: null, content: `whole xlsx ${zip.length}` },
    ]);
  });
});

describe('limits and malformed workbooks are decided before anydoc runs', () => {
  it('runs the cell pre-check before anydoc', async () => {
    const error = await conversionErrorOf(() =>
      convertXlsx(buildOverCellLimitXlsx(), limits()),
    );

    expect(error.kind).toBe('limit_exceeded');
    expect(sentPackages()).toEqual([]);
  });

  it('honours a small cell limit', async () => {
    const error = await conversionErrorOf(() =>
      convertXlsx(
        buildBook([['A', ['1', '2', '3']]]),
        limits({ maxXlsxCells: 2 }),
      ),
    );

    expect(error.kind).toBe('limit_exceeded');
    expect(sentPackages()).toEqual([]);
  });

  it('rejects a sheet list longer than the entry limit', async () => {
    const workbook = withWorkbook(book([['A', ['a']]]), (xml) => {
      const entry = /<sheet\b[^>]*\/>/.exec(xml)?.[0] ?? '';
      return replaceOrThrow(xml, entry, entry.repeat(50_000));
    });

    const error = await conversionErrorOf(() =>
      convertXlsx(workbook, limits()),
    );

    expect(error.kind).toBe('limit_exceeded');
    expect(sentPackages()).toEqual([]);
  });

  it('rejects a workbook.xml beyond the size limit', async () => {
    const workbook = withWorkbook(book([['A', ['a']]]), (xml) =>
      replaceOrThrow(
        xml,
        '<sheets>',
        `<!--${'x'.repeat(1_200_000)}--><sheets>`,
      ),
    );

    const error = await conversionErrorOf(() =>
      convertXlsx(workbook, limits({ maxArchiveUncompressedBytes: MIB })),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  it('treats a workbook.xml that is not well-formed as malformed', async () => {
    const workbook = withWorkbook(book([['A', ['a']]]), (xml) =>
      xml.slice(0, Math.floor(xml.length / 2)),
    );

    const error = await conversionErrorOf(() =>
      convertXlsx(workbook, limits()),
    );

    expect(error.kind).toBe('malformed');
    expect(sentPackages()).toEqual([]);
  });

  it('treats an unknown encoding in the XML declaration as malformed', async () => {
    const workbook = withWorkbook(
      book([['A', ['a']]]),
      (xml) =>
        `<?xml version="1.0" encoding="UTF-9"?>${xml.replace(/^<\?xml[^>]*\?>/, '')}`,
    );

    const error = await conversionErrorOf(() =>
      convertXlsx(workbook, limits()),
    );

    expect(error.kind).toBe('malformed');
  });

  it('refuses entity expansion in the workbook as malformed', async () => {
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE w [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;">]>' +
      `<workbook xmlns="${MAIN_NS}"><sheets><sheet name="&b;" sheetId="1"/></sheets></workbook>`;
    const workbook = withWorkbook(book([['A', ['a']]]), () => bomb);

    const error = await conversionErrorOf(() =>
      convertXlsx(workbook, limits()),
    );

    expect(error.kind).toBe('malformed');
  });
});
