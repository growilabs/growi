import { buildEpub } from './epub';
import { buildOpenDocument } from './opendocument';
import { buildImageOnlyPdf, buildTextPdf } from './pdf';
import { buildPptx } from './pptx';
import { buildRtf } from './rtf';
import { encodeText } from './text-encoding';
import { buildXls } from './xls';
import { buildXlsx } from './xlsx';

// The ordinary documents of the Python service's tests/fixture_files.py,
// rebuilt with the Node generators: same names, same content.

export const JAPANESE_SAMPLE =
  '障害対応メモ\n本番環境で発生した情報システムの障害';

export interface PlainDocument {
  /** The Python fixture name plus an extension, for dumping to disk. */
  readonly fileName: string;
  readonly build: () => Buffer;
}

const ODT_BODY =
  '<office:text><text:h>見出し</text:h><text:p>OpenDocument text marker</text:p></office:text>';
const ODS_BODY =
  '<office:spreadsheet>' +
  '<table:table table:name="First"><table:table-row><table:table-cell office:value-type="string">' +
  '<text:p>OpenDocument sheet marker</text:p></table:table-cell></table:table-row></table:table>' +
  '<table:table table:name="Second"><table:table-row><table:table-cell office:value-type="string">' +
  '<text:p>second sheet</text:p></table:table-cell></table:table-row></table:table>' +
  '</office:spreadsheet>';
const ODP_BODY =
  '<office:presentation><draw:page draw:name="page1"><draw:frame svg:x="1cm" svg:y="1cm" ' +
  'svg:width="10cm" svg:height="2cm"><draw:text-box><text:p>OpenDocument slide marker</text:p>' +
  '</draw:text-box></draw:frame></draw:page></office:presentation>';

export const PLAIN_DOCUMENTS = {
  xlsxMultiSheet: {
    fileName: 'xlsx_multi_sheet.xlsx',
    build: () =>
      buildXlsx([
        {
          name: '売上',
          rows: [
            ['商品', '数量'],
            ['りんご', 3],
            ['みかん', 5],
          ],
        },
        { name: 'Summary <#1>', rows: [['Total', 8]] },
        { name: 'Empty' },
      ]),
  },
  xlsxSingleSheet: {
    fileName: 'xlsx_single_sheet.xlsx',
    build: () =>
      buildXlsx([{ name: 'OnlySheet', rows: [['single sheet marker']] }]),
  },
  xlsxHiddenSheet: {
    fileName: 'xlsx_hidden_sheet.xlsx',
    build: () =>
      buildXlsx([
        { name: 'Visible', rows: [['visible marker']] },
        { name: 'Secret', rows: [['hidden marker']], state: 'hidden' },
      ]),
  },
  xlsxChartSheet: {
    fileName: 'xlsx_chart_sheet.xlsx',
    build: () =>
      buildXlsx([
        {
          name: 'Data',
          rows: [
            ['Month', 'Sales'],
            ['Jan', 10],
            ['Feb', 20],
            ['Mar', 30],
          ],
        },
        {
          name: 'Chart',
          chart: {
            dataSheet: 'Data',
            categories: '$A$2:$A$4',
            values: '$B$2:$B$4',
          },
        },
      ]),
  },
  pptxMultiSlide: {
    fileName: 'pptx_multi_slide.pptx',
    build: () =>
      buildPptx([
        { title: 'Slide One', body: 'first slide body' },
        { title: 'Slide Two', body: 'second slide body' },
        { title: 'Slide Three', body: 'third slide body' },
      ]),
  },
  pdfText: {
    fileName: 'pdf_text.pdf',
    build: () => buildTextPdf(['PDF page 1', 'PDF page 2', 'PDF page 3']),
  },
  pdfImageOnly: { fileName: 'pdf_image_only.pdf', build: buildImageOnlyPdf },
  textShiftJis: {
    fileName: 'text_shift_jis.txt',
    build: () => encodeText(JAPANESE_SAMPLE, 'shift_jis'),
  },
  textEucJp: {
    fileName: 'text_euc_jp.txt',
    build: () => encodeText(JAPANESE_SAMPLE, 'euc-jp'),
  },
  textUtf8Bom: {
    fileName: 'text_utf8_bom.txt',
    build: () => encodeText(JAPANESE_SAMPLE, 'utf-8-bom'),
  },
  odt: {
    fileName: 'odt.odt',
    build: () => buildOpenDocument('text', ODT_BODY),
  },
  ods: {
    fileName: 'ods.ods',
    build: () => buildOpenDocument('spreadsheet', ODS_BODY),
  },
  odp: {
    fileName: 'odp.odp',
    build: () => buildOpenDocument('presentation', ODP_BODY),
  },
  epub: {
    fileName: 'epub.epub',
    build: () =>
      buildEpub({
        title: 'Fixture Book',
        language: 'ja',
        chapters: [
          {
            title: 'Chapter 1',
            bodyXhtml: '<h1>第一章</h1><p>EPUB chapter marker</p>',
          },
        ],
      }),
  },
  rtf: {
    fileName: 'rtf.rtf',
    build: () => buildRtf(`RTF body marker\n${JAPANESE_SAMPLE}`),
  },
  xls: {
    fileName: 'xls.xls',
    build: () =>
      buildXls([
        { name: 'First', rows: [['XLS cell marker', 42]] },
        { name: 'Second', rows: [['second sheet']] },
      ]),
  },
} satisfies Record<string, PlainDocument>;

export type PlainDocumentKey = keyof typeof PLAIN_DOCUMENTS;
