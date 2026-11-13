import { readFileSync } from 'node:fs';

import {
  allContent,
  codePoints,
  type Extracted,
  extractedOf,
  postFile,
} from '../../src/http/spec-support/extract-client';
import {
  buildDocx,
  buildImageOnlyPdf,
  buildOwnerPasswordOnlyPdf,
  buildTextPdf,
  JAPANESE_SAMPLE,
  LEGACY_DOC_PATH,
  LEGACY_PPT_PATH,
  PDF_PAGE_TEXTS,
  PLAIN_DOCUMENTS,
} from '../fixtures';
import { useBlackboxService } from './blackbox-service';

// Black box (research.md 22.7 `formats`): every format the service reads, over
// HTTP with the default settings. Python test_e2e_http.py TestFormatsOverHttp
// (29 formats + 7 single checks), plus 17.10: extractedCharacters counts code
// points, as Python's len() does.

const service = useBlackboxService();

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const IPYNB = JSON.stringify({
  cells: [
    { cell_type: 'markdown', metadata: {}, source: ['# Notebook title'] },
    {
      cell_type: 'code',
      metadata: {},
      execution_count: 1,
      source: ["print('cell source marker')"],
      outputs: [
        {
          output_type: 'stream',
          name: 'stdout',
          text: ['cell output marker\n'],
        },
        {
          output_type: 'display_data',
          metadata: {},
          data: { 'image/png': 'QUJD'.repeat(50) },
        },
      ],
    },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
});

const HTML =
  '<html><head><title>Page title</title><script>var hidden_script = 1;</script><style>p{color:red}</style></head>' +
  '<body><p>html body marker</p></body></html>';

type Positions = readonly (readonly [number | null, string | null])[];
const PAGED_PDF: Positions = [
  [1, '1'],
  [2, '2'],
  [3, '3'],
];
const SINGLE: Positions = [[null, null]];

interface FormatRow {
  readonly data: () => Uint8Array | string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly markers: readonly string[];
  readonly positions: Positions;
}

const FORMATS: Readonly<Record<string, FormatRow>> = {
  pdf: {
    data: () => buildTextPdf(PDF_PAGE_TEXTS),
    fileName: 'a.pdf',
    mimeType: 'application/pdf',
    markers: ['PDF page 1', 'PDF page 2', 'PDF page 3'],
    positions: PAGED_PDF,
  },
  'pdf-owner-password-only': {
    data: buildOwnerPasswordOnlyPdf,
    fileName: 'a.pdf',
    mimeType: 'application/pdf',
    markers: ['PDF page 1', 'PDF page 3'],
    positions: PAGED_PDF,
  },
  'pdf-image-only': {
    data: buildImageOnlyPdf,
    fileName: 'scan.pdf',
    mimeType: 'application/pdf',
    markers: [],
    positions: SINGLE,
  },
  pptx: {
    data: PLAIN_DOCUMENTS.pptxMultiSlide.build,
    fileName: 'a.pptx',
    mimeType: PPTX,
    markers: ['Slide One', 'second slide body', 'Slide Three'],
    positions: PAGED_PDF,
  },
  'xlsx-multi-sheet': {
    data: PLAIN_DOCUMENTS.xlsxMultiSheet.build,
    fileName: 'a.xlsx',
    mimeType: XLSX,
    markers: ['りんご', 'Total'],
    positions: [
      [1, '売上'],
      [2, 'Summary <#1>'],
    ],
  },
  'xlsx-single-sheet': {
    data: PLAIN_DOCUMENTS.xlsxSingleSheet.build,
    fileName: 'a.xlsx',
    mimeType: XLSX,
    markers: ['single sheet marker'],
    positions: [[1, 'OnlySheet']],
  },
  'xlsx-hidden-sheet': {
    data: PLAIN_DOCUMENTS.xlsxHiddenSheet.build,
    fileName: 'a.xlsx',
    mimeType: XLSX,
    markers: ['visible marker', 'hidden marker'],
    positions: [
      [1, 'Visible'],
      [2, 'Secret'],
    ],
  },
  'xlsx-chart-sheet': {
    data: PLAIN_DOCUMENTS.xlsxChartSheet.build,
    fileName: 'a.xlsx',
    mimeType: XLSX,
    markers: ['Jan', 'Mar'],
    positions: [[1, 'Data']],
  },
  docx: {
    data: () => buildDocx(['docx marker 日本語']),
    fileName: 'a.docx',
    mimeType: DOCX,
    markers: ['docx marker 日本語'],
    positions: SINGLE,
  },
  rtf: {
    data: PLAIN_DOCUMENTS.rtf.build,
    fileName: 'a.rtf',
    mimeType: 'application/rtf',
    markers: ['RTF body marker', '情報システム'],
    positions: SINGLE,
  },
  epub: {
    data: PLAIN_DOCUMENTS.epub.build,
    fileName: 'a.epub',
    mimeType: 'application/epub+zip',
    markers: ['EPUB chapter marker'],
    positions: SINGLE,
  },
  odt: {
    data: PLAIN_DOCUMENTS.odt.build,
    fileName: 'a.odt',
    mimeType: 'application/vnd.oasis.opendocument.text',
    markers: ['OpenDocument text marker'],
    positions: SINGLE,
  },
  ods: {
    data: PLAIN_DOCUMENTS.ods.build,
    fileName: 'a.ods',
    mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
    markers: ['OpenDocument sheet marker', 'second sheet'],
    positions: SINGLE,
  },
  odp: {
    data: PLAIN_DOCUMENTS.odp.build,
    fileName: 'a.odp',
    mimeType: 'application/vnd.oasis.opendocument.presentation',
    markers: ['OpenDocument slide marker'],
    positions: SINGLE,
  },
  doc: {
    data: () => readFileSync(LEGACY_DOC_PATH),
    fileName: 'a.doc',
    mimeType: 'application/msword',
    markers: ['This text is below the table.'],
    positions: SINGLE,
  },
  ppt: {
    data: () => readFileSync(LEGACY_PPT_PATH),
    fileName: 'a.ppt',
    mimeType: 'application/vnd.ms-powerpoint',
    markers: ['Text in a TextBox'],
    positions: SINGLE,
  },
  xls: {
    data: PLAIN_DOCUMENTS.xls.build,
    fileName: 'a.xls',
    mimeType: 'application/vnd.ms-excel',
    markers: ['XLS cell marker', 'second sheet'],
    positions: SINGLE,
  },
  html: {
    data: () => HTML,
    fileName: 'a.html',
    mimeType: 'text/html',
    markers: ['Page title', 'html body marker'],
    positions: SINGLE,
  },
  xml: {
    data: () => '<root><item>xml marker</item></root>',
    fileName: 'a.xml',
    mimeType: 'text/xml',
    markers: ['xml marker'],
    positions: SINGLE,
  },
  ipynb: {
    data: () => IPYNB,
    fileName: 'a.ipynb',
    mimeType: 'application/x-ipynb+json',
    markers: ['Notebook title', 'cell source marker', 'cell output marker'],
    positions: SINGLE,
  },
  csv: {
    data: () => 'name,qty\napple,3\n',
    fileName: 'a.csv',
    mimeType: 'text/csv',
    markers: ['| name | qty |', '| apple | 3 |'],
    positions: SINGLE,
  },
  tsv: {
    data: () => 'name\tqty\napple\t3\n',
    fileName: 'a.tsv',
    mimeType: 'text/tab-separated-values',
    markers: ['| name | qty |', '| apple | 3 |'],
    positions: SINGLE,
  },
  txt: {
    data: () => 'plain text marker',
    fileName: 'a.txt',
    mimeType: 'text/plain',
    markers: ['plain text marker'],
    positions: SINGLE,
  },
  md: {
    data: () => '# Heading\n\nmarkdown marker',
    fileName: 'a.md',
    mimeType: 'text/markdown',
    markers: ['markdown marker'],
    positions: SINGLE,
  },
  json: {
    data: () => '{"key": "json marker"}',
    fileName: 'a.json',
    mimeType: 'application/json',
    markers: ['json marker'],
    positions: SINGLE,
  },
  yaml: {
    data: () => 'key: yaml marker\n',
    fileName: 'a.yaml',
    mimeType: 'text/yaml',
    markers: ['yaml marker'],
    positions: SINGLE,
  },
  'shift-jis': {
    data: PLAIN_DOCUMENTS.textShiftJis.build,
    fileName: 'sjis.txt',
    mimeType: 'text/plain',
    markers: [JAPANESE_SAMPLE],
    positions: SINGLE,
  },
  'euc-jp': {
    data: PLAIN_DOCUMENTS.textEucJp.build,
    fileName: 'euc.txt',
    mimeType: 'text/plain',
    markers: [JAPANESE_SAMPLE],
    positions: SINGLE,
  },
  'utf8-bom': {
    data: PLAIN_DOCUMENTS.textUtf8Bom.build,
    fileName: 'bom.txt',
    mimeType: 'text/plain',
    markers: [JAPANESE_SAMPLE],
    positions: SINGLE,
  },
};

const post = async (
  fileName: string,
  data: Uint8Array | string,
  mimeType?: string,
): Promise<Extracted> => {
  const { url, token } = service();
  return extractedOf(await postFile(url, fileName, data, { token, mimeType }));
};

describe('POST /extract per format', () => {
  it.each(
    Object.keys(FORMATS),
  )('%s: unit, number, label and MIME type', async (name) => {
    const row = FORMATS[name];
    if (row === undefined) throw new Error(`no row ${name}`);

    const extracted = await post(row.fileName, row.data());

    expect(extracted.mimeType).toBe(row.mimeType);
    expect(extracted.pages.map((p) => [p.pageNumber, p.label])).toEqual(
      row.positions,
    );
    for (const marker of row.markers) {
      expect(allContent(extracted)).toContain(marker);
    }
    expect(extracted.extractedCharacters).toBe(
      extracted.pages.reduce((sum, page) => sum + codePoints(page.content), 0),
    );
  });

  it('keeps the text of each XLSX sheet in its own element', async () => {
    const { pages } = await post(
      'a.xlsx',
      PLAIN_DOCUMENTS.xlsxMultiSheet.build(),
    );

    expect(pages[0]?.content).toContain('りんご');
    expect(pages[0]?.content).not.toContain('Total');
    expect(pages[1]?.content).toContain('Total');
    expect(pages[1]?.content).not.toContain('りんご');
  });

  it('gives an empty XLSX sheet no element', async () => {
    const { pages } = await post(
      'a.xlsx',
      PLAIN_DOCUMENTS.xlsxMultiSheet.build(),
    );

    expect(pages.map((p) => p.label)).not.toContain('Empty');
  });

  it('never returns the image data embedded in a notebook', async () => {
    const extracted = await post('a.ipynb', IPYNB);

    expect(allContent(extracted)).not.toContain('QUJD');
  });

  it('drops the script and style content of HTML', async () => {
    const text = allContent(await post('a.html', HTML));

    expect(text).not.toContain('hidden_script');
    expect(text).not.toContain('color:red');
  });

  it('does not expand XML entities', async () => {
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;">]><r>&b;</r>';

    expect(allContent(await post('a.xml', bomb))).not.toContain('AAAAAAAAAA');
  });

  it('lets the mimeType hint decide a file without an extension', async () => {
    const extracted = await post('no-extension', 'hinted text', 'text/plain');

    expect(extracted.pages[0]?.content).toBe('hinted text');
  });

  it('returns the PDF page texts without closing gaps between ASCII words', async () => {
    const { pages } = await post('a.pdf', buildTextPdf(PDF_PAGE_TEXTS));

    expect(pages.map((p) => p.content)).toEqual([...PDF_PAGE_TEXTS]);
  });
});

describe('extractedCharacters counts Unicode code points (17.10)', () => {
  it('counts a character outside the BMP once, not as two UTF-16 units', async () => {
    const text = '𠮷野家で😀ランチ';

    const extracted = await post('a.txt', text);

    expect(extracted.pages[0]?.content).toBe(text);
    expect(extracted.extractedCharacters).toBe(8);
    expect(text.length).toBe(10);
  });

  it('sums the code points of every page', async () => {
    const extracted = await post('a.pdf', buildTextPdf(PDF_PAGE_TEXTS));

    expect(extracted.extractedCharacters).toBe(PDF_PAGE_TEXTS.join('').length);
  });
});
