import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc';

import {
  buildArtefactDeck,
  buildBrokenXmlDocx,
  buildDeckWithText,
  buildDeeplyNestedDocx,
  buildDocxWithoutDocumentPart,
  buildDuplicatedEntryXlsx,
  buildEncryptedDocx,
  buildEncryptedPptx,
  buildEncryptedXlsx,
  buildGrayPng,
  buildPptx,
  buildStaleReferenceXlsx,
  buildTruncatedDocx,
  buildXlsx,
  buildZip,
  buildZipBombDocx,
  editPart,
  LEGACY_DOC_PATH,
  LEGACY_PPT_PATH,
  PLAIN_DOCUMENTS,
  type PptxSlide,
  pptxParts,
  type XlsxSheet,
  xlsxParts,
  zipSignatureFollowedBy,
} from '../../test/fixtures';
import {
  anydocErrorCode,
  anydocMarkdown,
} from '../../test/fixtures/spec-support';

// Contract tests pinned to @firecrawl/anydoc 0.2.4: the undocumented
// behaviours the PPTX / XLSX splitters, the format table and the error
// classification rely on. They call anydoc directly and import nothing from
// src/, so they keep running (and must stay green) before and after the
// conversion layer exists. Raising the anydoc version requires these to pass
// (Req 4.2).

const PINNED_VERSION = '0.2.4';

const smallPicture = (description: string) => ({
  image: buildGrayPng(8, Buffer.alloc(64, 128)),
  description,
});

// The stale-reference workbook's parts, so its sheets can be renamed in place.
const staleReferenceParts = () =>
  xlsxParts(
    [
      {
        name: 'Alpha',
        rows: [
          ['alpha value', { formula: 'Beta!A1', cached: 'cached from beta' }],
        ],
      },
      { name: 'Beta', rows: [['beta value']] },
    ],
    {
      definedNames: [
        { name: 'named_cell', text: 'Beta!$A$1' },
        { name: '_xlnm.Print_Titles', text: "'Alpha'!$1:$1", localSheetId: 0 },
      ],
    },
  );

const sheetHeadings = (markdown: string): string[] =>
  markdown.split('\n').filter((line) => line.startsWith('## '));

/** The per-sheet bodies, cut at the "## " headings. */
const sheetBodies = (markdown: string): string[] =>
  markdown
    .split(/^## .*\n/m)
    .slice(1)
    .map((body) => body.replace(/^\n+|\n+$/g, ''));

const renameSheets = (
  sheets: readonly XlsxSheet[],
  names: readonly string[],
): Buffer =>
  buildZip(
    editPart(xlsxParts(sheets), 'xl/workbook.xml', (xml) => {
      let next = 0;
      return xml.replace(
        /(<sheet\b[^>]*?\bname=)"[^"]*"/g,
        (_match, head: string) => `${head}"${names[next++]}"`,
      );
    }),
  );

describe('the pinned anydoc', () => {
  it(`is version ${PINNED_VERSION}`, () => {
    const require = createRequire(import.meta.url);
    const { version } = require('@firecrawl/anydoc/package.json');

    expect(version).toBe(PINNED_VERSION);
  });

  it.each([
    'doc',
    'docx',
    'odt',
    'ppt',
    'pptx',
    'rtf',
    'epub',
    'xlsx',
    'ods',
    'odp',
    'csv',
  ])('names the format %s after its extension', (extension) => {
    expect(formatFromExtension(extension)).toBe(extension);
  });
});

describe('XLS goes to anydoc under the format name xlsx', () => {
  it('has no format of its own: the xls extension maps to xlsx', () => {
    expect(formatFromExtension('xls')).toBe(formatFromExtension('xlsx'));
  });

  it('converts legacy XLS bytes given the xlsx format, one heading per sheet', async () => {
    expect(
      await toMarkdownBytes(
        PLAIN_DOCUMENTS.xls.build(),
        formatFromExtension('xlsx'),
      ),
    ).toBe(
      '## First\n\n|  |  |\n| --- | --- |\n| XLS cell marker | 42 |\n\n' +
        '## Second\n\n|  |\n| --- |\n| second sheet |\n',
    );
  });
});

describe('PPTX: converting slide by slide gives the whole-deck text', () => {
  const CONTRACT_SLIDES: readonly PptxSlide[] = [
    { title: 'Moved to the front' },
    {
      title: 'Opening slide',
      body: 'first bullet\nsecond bullet',
      notes: 'speaker notes for the opening',
    },
    {
      title: 'Table slide',
      table: [
        ['head A', 'head B'],
        ['cell 1', 'cell 2'],
      ],
    },
    {
      title: 'Image and group',
      pictures: [smallPicture('image.png')],
      group: { textboxes: ['grouped text'] },
    },
    { title: 'Hidden slide', hidden: true },
    {},
  ];

  const MULTI_SLIDES: readonly PptxSlide[] = [
    { title: 'Slide One', body: 'first slide body' },
    { title: 'Slide Two', body: 'second slide body' },
    { title: 'Slide Three', body: 'third slide body' },
  ];

  const ARTEFACT_SLIDES: readonly PptxSlide[] = [
    {
      title: 'Artefacts',
      pictures: [
        smallPicture('A cat\n\nAI-generated content may be incorrect.'),
      ],
      textboxes: ['Disclaimer: AI-generated content may be incorrect.'],
      notes: 'line one\vline two',
    },
    {
      pictures: [smallPicture('A dog\n\nDescription automatically generated')],
    },
    { title: 'Last', textboxes: ['end\vof deck'] },
  ];

  it.each([
    ['contract', CONTRACT_SLIDES],
    ['multi-slide', MULTI_SLIDES],
    ['artefacts', ARTEFACT_SLIDES],
  ])('joins one-slide decks with "\\n" into the whole-deck output (%s)', async (_name, slides) => {
    const whole = await anydocMarkdown(buildPptx(slides), 'pptx');
    const perSlide = await Promise.all(
      slides.map((slide) => anydocMarkdown(buildPptx([slide]), 'pptx')),
    );

    expect(perSlide.filter((text) => text !== '').join('\n')).toBe(whole);
  });

  it('writes nothing for a slide without text, and still writes a hidden slide', async () => {
    expect(await anydocMarkdown(buildPptx([{}]), 'pptx')).toBe('');
    expect(
      await anydocMarkdown(
        buildPptx([{ title: 'Hidden slide', hidden: true }]),
        'pptx',
      ),
    ).toBe('## Hidden slide\n');
  });

  it('reads the slides in slide-list order, not in part-name order', async () => {
    const reordered = buildZip(
      editPart(pptxParts(MULTI_SLIDES), 'ppt/presentation.xml', (xml) => {
        const entries = xml.match(/<p:sldId [^>]*\/>/g) ?? [];
        return xml.replace(entries.join(''), entries.reverse().join(''));
      }),
    );

    const headings = sheetHeadings(await anydocMarkdown(reordered, 'pptx'));

    expect(headings).toEqual([
      '## Slide Three',
      '## Slide Two',
      '## Slide One',
    ]);
  });

  it('needs only the XML parts: a slide whose image part is missing gives the same text', async () => {
    const slides: readonly PptxSlide[] = [
      { title: 'Pictured', pictures: [smallPicture('alt of the picture')] },
    ];
    const withoutMedia = buildZip(
      pptxParts(slides).filter((part) => !part.name.startsWith('ppt/media/')),
    );

    expect(await anydocMarkdown(withoutMedia, 'pptx')).toBe(
      await anydocMarkdown(buildPptx(slides), 'pptx'),
    );
  });

  it('folds generated alt text onto one line joined by two spaces', async () => {
    const markdown = await anydocMarkdown(buildArtefactDeck(), 'pptx');

    expect(markdown.split('\n')).toContain(
      'A cat  AI-generated content may be incorrect.',
    );
    expect(markdown.split('\n')).toContain(
      'A dog  Description automatically generated',
    );
    expect(markdown.split('\n')).toContain(
      'Disclaimer: AI-generated content may be incorrect.',
    );
  });

  it('marks a soft line break with a trailing backslash and escapes a literal one as "\\\\"', async () => {
    expect(
      await anydocMarkdown(
        buildDeckWithText('first line\vsecond line'),
        'pptx',
      ),
    ).toBe('first line\\\nsecond line\n');
    expect(
      await anydocMarkdown(buildDeckWithText('path C:\\\vnext line'), 'pptx'),
    ).toBe('path C:\\\\\\\nnext line\n');
  });
});

describe('XLSX: the sheet headings the marker split cuts at', () => {
  const PLAIN_SHEETS: readonly XlsxSheet[] = [
    { name: '売上', rows: [['商品'], ['りんご']] },
    { name: 'Summary <#1>', rows: [['Total']] },
    { name: 'Third', rows: [['3']] },
  ];

  it('writes "## <name>", a blank line, the table, and one blank line between sheets', async () => {
    expect(await anydocMarkdown(buildXlsx(PLAIN_SHEETS), 'xlsx')).toBe(
      '## 売上\n\n| 商品 |\n| --- |\n| りんご |\n\n' +
        '## Summary <#1>\n\n|  |\n| --- |\n| Total |\n\n' +
        '## Third\n\n|  |\n| --- |\n| 3 |\n',
    );
  });

  it('prints alphanumeric marker names verbatim, in workbook order, with the same bodies', async () => {
    const markers = ['ZZ0a1b1ZZ', 'ZZ0a1b2ZZ', 'ZZ0a1b3ZZ'];
    const original = await anydocMarkdown(buildXlsx(PLAIN_SHEETS), 'xlsx');

    const marked = await anydocMarkdown(
      renameSheets(PLAIN_SHEETS, markers),
      'xlsx',
    );

    expect(sheetHeadings(marked)).toEqual(markers.map((m) => `## ${m}`));
    expect(sheetBodies(marked)).toEqual(sheetBodies(original));
  });

  it('keeps cached formula values and defined names when the sheets are renamed', async () => {
    const original = await anydocMarkdown(buildStaleReferenceXlsx(), 'xlsx');
    const renamed = buildZip(
      editPart(staleReferenceParts(), 'xl/workbook.xml', (xml) =>
        xml
          .replace('name="Alpha"', 'name="ZZm1ZZ"')
          .replace('name="Beta"', 'name="ZZm2ZZ"'),
      ),
    );

    const marked = await anydocMarkdown(renamed, 'xlsx');

    expect(sheetBodies(marked)).toEqual(sheetBodies(original));
    expect(marked).toContain('cached from beta');
  });

  it('escapes names in headings ([, \\, <, and & of a literal &amp;)', async () => {
    const markdown = await anydocMarkdown(
      buildXlsx([
        { name: '[draft] a\\b', rows: [['v0']] },
        { name: 'a<b', rows: [['v1']] },
        { name: 'literal &amp; text', rows: [['v2']] },
      ]),
      'xlsx',
    );

    expect(sheetHeadings(markdown)).toEqual([
      '## \\[draft] a\\\\b',
      '## a\\<b',
      '## literal &amp;amp; text',
    ]);
  });

  it('prints no heading for a name that is only whitespace', async () => {
    const markdown = await anydocMarkdown(
      buildXlsx([
        { name: '   ', rows: [['blank named']] },
        { name: 'Normal', rows: [['normal']] },
      ]),
      'xlsx',
    );

    expect(sheetHeadings(markdown)).toEqual(['## Normal']);
    expect(markdown).toContain('blank named');
  });

  it('prints no heading when the workbook has a single sheet', async () => {
    expect(
      await anydocMarkdown(PLAIN_DOCUMENTS.xlsxSingleSheet.build(), 'xlsx'),
    ).toBe('|  |\n| --- |\n| single sheet marker |\n');
  });

  it.each<'hidden' | 'veryHidden'>([
    'hidden',
    'veryHidden',
  ])('leaves out a %s sheet (so the splitter makes every sheet visible)', async (state) => {
    const markdown = await anydocMarkdown(
      buildXlsx([
        { name: 'Shown', rows: [['shown text']] },
        { name: 'Kept', rows: [['kept text']], state },
      ]),
      'xlsx',
    );

    expect(markdown).toBe('|  |\n| --- |\n| shown text |\n');
  });

  it('leaves out empty sheets and chart sheets', async () => {
    expect(
      sheetHeadings(
        await anydocMarkdown(PLAIN_DOCUMENTS.xlsxMultiSheet.build(), 'xlsx'),
      ),
    ).toEqual(['## 売上', '## Summary <#1>']);
    expect(
      await anydocMarkdown(PLAIN_DOCUMENTS.xlsxChartSheet.build(), 'xlsx'),
    ).toBe(
      '## Data\n\n| Month | Sales |\n| --- | --- |\n| Jan | 10 |\n| Feb | 20 |\n| Mar | 30 |\n',
    );
    expect(
      await anydocMarkdown(buildXlsx([{ name: 'A' }, { name: 'B' }]), 'xlsx'),
    ).toBe('');
  });

  it('never starts a line with cell text shaped like a heading', async () => {
    const forged = '## ZZ0123456789abcdef0123456789abcdef1ZZ';

    const markdown = await anydocMarkdown(
      buildXlsx([
        { name: 'One', rows: [[forged]] },
        { name: 'Two', rows: [['two']] },
      ]),
      'xlsx',
    );

    expect(sheetHeadings(markdown)).toEqual(['## One', '## Two']);
    expect(markdown).toContain(forged);
  });

  it('reads the last copy of a duplicated entry', async () => {
    const markdown = await anydocMarkdown(buildDuplicatedEntryXlsx(), 'xlsx');

    expect(markdown).toContain('second copy');
    expect(markdown).not.toContain('first copy');
  });
});

describe('the ConvertErrorCode anydoc rejects with', () => {
  it.each([
    ['an encrypted DOCX', buildEncryptedDocx, 'docx', 'encrypted'],
    ['an encrypted XLSX', buildEncryptedXlsx, 'xlsx', 'encrypted'],
    ['an encrypted PPTX', buildEncryptedPptx, 'pptx', 'encrypted'],
    ['a truncated DOCX', buildTruncatedDocx, 'docx', 'malformed'],
    ['a DOCX with broken XML', buildBrokenXmlDocx, 'docx', 'malformed'],
    [
      'a DOCX without its document part',
      buildDocxWithoutDocumentPart,
      'docx',
      'missingPart',
    ],
    ['a ZIP-bomb DOCX', buildZipBombDocx, 'docx', 'resourceLimit'],
    [
      'a deeply nested DOCX',
      () => buildDeeplyNestedDocx(),
      'docx',
      'resourceLimit',
    ],
    [
      'a ZIP signature followed by text, as DOCX',
      () => zipSignatureFollowedBy('not really a zip'),
      'docx',
      'malformed',
    ],
    [
      'a legacy DOC given as DOCX',
      () => readFileSync(LEGACY_DOC_PATH),
      'docx',
      'malformed',
    ],
    [
      'a legacy PPT given as PPTX',
      () => readFileSync(LEGACY_PPT_PATH),
      'pptx',
      'malformed',
    ],
    [
      'bytes that are not a ZIP, as XLSX',
      () => Buffer.from('not a zip at all'),
      'xlsx',
      'malformed',
    ],
  ])('is %s -> %s', async (_name, build, extension, code) => {
    expect(await anydocErrorCode(build(), extension)).toBe(code);
  });

  it('is unsupported for bytes of no known format given no format', async () => {
    const rejection = toMarkdownBytes(Buffer.from('plain words'), null);

    await expect(rejection).rejects.toBeInstanceOf(Error);
    await expect(rejection).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('names the crossed limit as "(max_...)" in a resourceLimit message, which may also quote part names', async () => {
    const messageOf = async (bytes: Buffer): Promise<string> => {
      try {
        await anydocMarkdown(bytes, 'docx');
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error('anydoc converted the document without an error');
    };

    expect(await messageOf(buildDeeplyNestedDocx())).toMatch(/\(max_[a-z_]+\)/);
    const bombMessage = await messageOf(buildZipBombDocx());
    expect(bombMessage).toMatch(/\(max_[a-z_]+\)/);
    expect(bombMessage).toContain('word/document.xml');
  });
});
