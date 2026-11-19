import { anydocMarkdown, readZipEntries, readZipText } from './spec-support';
import { buildXlsx } from './xlsx';

const unescapeXml = (text: string): string =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');

// The same pattern the Python split tests use to rewrite sheet entries.
const sheetElements = (xlsx: Buffer): string[] =>
  readZipText(xlsx, 'xl/workbook.xml').match(/<sheet\b[^>]*\/>/g) ?? [];

const attribute = (element: string, name: string): string | undefined => {
  const value = new RegExp(`\\b${name}="([^"]*)"`).exec(element)?.[1];
  return value == null ? undefined : unescapeXml(value);
};

describe('buildXlsx', () => {
  it('lists every sheet in order, each with a name and an explicit state', () => {
    const xlsx = buildXlsx([
      { name: 'Summary <#1>', rows: [['Total', 8]] },
      { name: 'Secret', rows: [['hidden marker']], state: 'hidden' },
      { name: 'Empty' },
    ]);

    const sheets = sheetElements(xlsx).map((element) => ({
      name: attribute(element, 'name'),
      state: attribute(element, 'state'),
    }));

    expect(sheets).toEqual([
      { name: 'Summary <#1>', state: 'visible' },
      { name: 'Secret', state: 'hidden' },
      { name: 'Empty', state: 'visible' },
    ]);
  });

  it('writes string and number cells that anydoc reads as a table', async () => {
    const xlsx = buildXlsx([
      {
        name: '売上',
        rows: [
          ['商品', '数量'],
          ['りんご', 3],
        ],
      },
    ]);

    const markdown = await anydocMarkdown(xlsx, 'xlsx');

    expect(markdown).toContain('| 商品 | 数量 |');
    expect(markdown).toContain('| りんご | 3 |');
  });

  it('closes each row right after its last cell', () => {
    const xlsx = buildXlsx([{ name: 'Data', rows: [['a', 1]] }]);

    expect(readZipText(xlsx, 'xl/worksheets/sheet1.xml')).toContain(
      '</c></row>',
    );
  });

  it('writes a sheet without rows as a worksheet with no cells', () => {
    const xlsx = buildXlsx([
      { name: 'Full', rows: [['x']] },
      { name: 'Empty' },
    ]);

    const emptySheet = readZipText(xlsx, 'xl/worksheets/sheet2.xml');
    expect(emptySheet).toContain('<sheetData>');
    expect(emptySheet).not.toMatch(/<c\b/);
  });

  it('keeps a hidden sheet out of what anydoc extracts', async () => {
    const xlsx = buildXlsx([
      { name: 'Visible', rows: [['visible marker']] },
      { name: 'Secret', rows: [['hidden marker']], state: 'hidden' },
    ]);

    const markdown = await anydocMarkdown(xlsx, 'xlsx');

    expect(markdown).toContain('visible marker');
    expect(markdown).not.toContain('hidden marker');
  });

  it('writes a chart sheet as a chartsheet part that draws a chart', async () => {
    const xlsx = buildXlsx([
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
    ]);

    const entries = readZipEntries(xlsx);
    expect(readZipText(xlsx, 'xl/_rels/workbook.xml.rels')).toContain(
      'Target="chartsheets/sheet1.xml"',
    );
    expect(readZipText(xlsx, 'xl/chartsheets/_rels/sheet1.xml.rels')).toContain(
      'Target="../drawings/drawing1.xml"',
    );
    expect(readZipText(xlsx, 'xl/drawings/_rels/drawing1.xml.rels')).toContain(
      'Target="../charts/chart1.xml"',
    );
    expect(entries.get('xl/charts/chart1.xml')?.toString()).toContain(
      "'Data'!$B$2:$B$2",
    );
    expect(await anydocMarkdown(xlsx, 'xlsx')).toContain('| Jan | 10 |');
  });
});

describe('buildXlsx formulas and defined names', () => {
  it('writes a formula cell with its cached string value, as openpyxl does', async () => {
    const xlsx = buildXlsx([
      {
        name: 'Alpha',
        rows: [
          ['alpha value', { formula: 'Beta!A1', cached: 'cached from beta' }],
        ],
      },
      { name: 'Beta', rows: [['beta value']] },
    ]);

    expect(readZipText(xlsx, 'xl/worksheets/sheet1.xml')).toContain(
      '<c r="B1" t="str"><f>Beta!A1</f><v>cached from beta</v></c></row>',
    );
    expect(await anydocMarkdown(xlsx, 'xlsx')).toContain('cached from beta');
  });

  it('writes defined names after the sheet list, scoped to a sheet when asked', () => {
    const xlsx = buildXlsx([{ name: 'Alpha' }, { name: 'Beta' }], {
      definedNames: [
        { name: 'named_cell', text: 'Beta!$A$1' },
        { name: '_xlnm.Print_Titles', text: "'Alpha'!$1:$1", localSheetId: 0 },
      ],
    });

    expect(readZipText(xlsx, 'xl/workbook.xml')).toContain(
      '</sheets><definedNames><definedName name="named_cell">Beta!$A$1</definedName>' +
        `<definedName name="_xlnm.Print_Titles" localSheetId="0">'Alpha'!$1:$1</definedName></definedNames>`,
    );
  });
});
