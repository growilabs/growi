import { readFileSync } from 'node:fs';

import {
  buildDocx,
  buildOpenDocument,
  buildPptx,
  buildXls,
  buildXlsx,
  LEGACY_DOC_PATH,
  LEGACY_PPT_PATH,
} from '../test/fixtures';
import type { ExpectedPage, ExpectedPhrase } from './answers';
import {
  type GeneratedDocument,
  MIME_TYPES,
  SINGLE_PAGE,
  sourceCharactersOf,
} from './corpus-document';

// Office documents with Japanese text, built with the test fixture generators
// (test/fixtures/), plus the committed Apache POI DOC / PPT, which hold no
// Japanese (test/fixtures/legacy/PROVENANCE.md).

const onPage = (page: number, texts: readonly string[]): ExpectedPhrase[] =>
  texts.map((text) => ({ text, page }));

const numberedPages = (count: number): ExpectedPage[] =>
  Array.from({ length: count }, (_, i) => ({
    pageNumber: i + 1,
    label: String(i + 1),
  }));

type Sheet = {
  readonly name: string;
  readonly rows: readonly (readonly (string | number)[])[];
};

const sheetsText = (sheets: readonly Sheet[]): string[] =>
  sheets.flatMap((sheet) => [sheet.name, ...sheet.rows.flat().map(String)]);

const DOCX_PARAGRAPHS = [
  '就業規則の改定について',
  '第1条（目的）\nこの規則は、従業員の労働条件および服務規律を定める。',
  '第2条（テレワーク勤務）\nテレワーク勤務制度を新設し、在宅勤務手当を月額3000円支給する。',
  '附則\nこの規則は2025年10月1日から施行する。',
];

const XLSX_SHEETS: readonly Sheet[] = [
  {
    name: '売上実績',
    rows: [
      ['月', '売上高', '前年比'],
      ['4月', 1250000, '105%'],
      ['5月', 1380000, '112%'],
    ],
  },
  {
    name: '顧客一覧',
    rows: [
      ['会社名', '担当者', '地域'],
      ['株式会社サンプル商事', '中村健太', '関東'],
      ['有限会社みどり農園', '吉田里美', '九州'],
    ],
  },
  { name: '備考', rows: [['来期は北海道エリアへの展開を予定している。']] },
];

const XLS_SHEETS: readonly Sheet[] = [
  {
    name: '出張旅費',
    rows: [
      ['行き先', '交通費', '宿泊費'],
      ['名古屋営業所', 22000, 9800],
    ],
  },
  { name: '承認', rows: [['承認者', '営業部長 伊藤']] },
];

const ODT_CONTENT =
  '<office:text><text:h>社内報 第12号</text:h>' +
  '<text:p>新しい福利厚生制度のご紹介</text:p>' +
  '<text:p>育児休業の取得率が向上しました。</text:p></office:text>';

const ODS_CONTENT =
  '<office:spreadsheet>' +
  '<table:table table:name="勤怠"><table:table-row><table:table-cell office:value-type="string">' +
  '<text:p>出勤日数</text:p></table:table-cell></table:table-row></table:table>' +
  '<table:table table:name="休暇"><table:table-row><table:table-cell office:value-type="string">' +
  '<text:p>有給休暇の残日数</text:p></table:table-cell></table:table-row></table:table>' +
  '</office:spreadsheet>';

const ODP_CONTENT =
  '<office:presentation><draw:page draw:name="page1"><draw:frame svg:x="1cm" svg:y="1cm" ' +
  'svg:width="10cm" svg:height="2cm"><draw:text-box><text:p>新製品発表会と記者会見</text:p>' +
  '</draw:text-box></draw:frame></draw:page></office:presentation>';

const PPTX_SLIDES = [
  { title: '事業計画説明会', body: '2025年度 中期経営計画\n代表取締役 加藤誠' },
  {
    title: '市場分析',
    body: '国内のクラウドサービス市場は拡大を続けている\n競合他社との差別化が課題',
  },
  {
    title: '今後の取り組み',
    body: '人材育成の強化\nデジタルトランスフォーメーションの推進',
  },
];

export const OFFICE_DOCUMENTS: readonly GeneratedDocument[] = [
  {
    answer: {
      fileName: 'docx-ja.docx',
      format: 'docx',
      mimeType: MIME_TYPES.docx,
      source:
        'benchmark/office-documents.ts: buildDocx (test/fixtures/docx.ts)',
      features: ['paragraph-line-break'],
      expectedPages: SINGLE_PAGE,
      phrases: onPage(1, [
        '就業規則',
        '労働条件',
        '服務規律',
        'テレワーク勤務制度',
        '在宅勤務手当',
        '施行',
      ]),
      sourceCharacters: sourceCharactersOf(...DOCX_PARAGRAPHS),
    },
    build: () => buildDocx(DOCX_PARAGRAPHS),
  },
  {
    answer: {
      fileName: 'xlsx-ja-multi-sheet.xlsx',
      format: 'xlsx',
      mimeType: MIME_TYPES.xlsx,
      source:
        'benchmark/office-documents.ts: buildXlsx (test/fixtures/xlsx.ts)',
      features: [],
      // The Python service labels a sheet with its name (checked 2026-11-04).
      expectedPages: XLSX_SHEETS.map((sheet, i) => ({
        pageNumber: i + 1,
        label: sheet.name,
        sheetName: sheet.name,
      })),
      phrases: [
        ...onPage(1, ['売上高', '前年比']),
        ...onPage(2, ['株式会社サンプル商事', '中村健太', 'みどり農園']),
        ...onPage(3, ['北海道エリア']),
      ],
      sourceCharacters: sourceCharactersOf(...sheetsText(XLSX_SHEETS)),
    },
    build: () => buildXlsx(XLSX_SHEETS),
  },
  {
    answer: {
      fileName: 'pptx-ja-multi-slide.pptx',
      format: 'pptx',
      mimeType: MIME_TYPES.pptx,
      source:
        'benchmark/office-documents.ts: buildPptx (test/fixtures/pptx.ts)',
      features: [],
      expectedPages: numberedPages(PPTX_SLIDES.length),
      phrases: [
        ...onPage(1, ['事業計画説明会', '中期経営計画', '加藤誠']),
        ...onPage(2, ['クラウドサービス市場', '差別化']),
        ...onPage(3, ['人材育成', 'デジタルトランスフォーメーション']),
      ],
      sourceCharacters: sourceCharactersOf(
        ...PPTX_SLIDES.flatMap((slide) => [slide.title, slide.body]),
      ),
    },
    build: () => buildPptx(PPTX_SLIDES),
  },
  {
    answer: {
      fileName: 'xls-ja.xls',
      format: 'xls',
      mimeType: MIME_TYPES.xls,
      source: 'benchmark/office-documents.ts: buildXls (test/fixtures/xls.ts)',
      features: [],
      expectedPages: SINGLE_PAGE,
      phrases: onPage(1, ['名古屋営業所', '交通費', '宿泊費', '承認者']),
      sourceCharacters: sourceCharactersOf(...sheetsText(XLS_SHEETS)),
    },
    build: () => buildXls(XLS_SHEETS),
  },
  {
    answer: {
      fileName: 'odt-ja.odt',
      format: 'odt',
      mimeType: MIME_TYPES.odt,
      source:
        'benchmark/office-documents.ts: buildOpenDocument (test/fixtures/opendocument.ts)',
      features: [],
      expectedPages: SINGLE_PAGE,
      phrases: onPage(1, ['社内報', '福利厚生制度', '育児休業']),
      sourceCharacters: sourceCharactersOf(ODT_CONTENT),
    },
    build: () => buildOpenDocument('text', ODT_CONTENT),
  },
  {
    answer: {
      fileName: 'ods-ja.ods',
      format: 'ods',
      mimeType: MIME_TYPES.ods,
      source:
        'benchmark/office-documents.ts: buildOpenDocument (test/fixtures/opendocument.ts)',
      features: [],
      expectedPages: SINGLE_PAGE,
      phrases: onPage(1, ['出勤日数', '有給休暇']),
      sourceCharacters: sourceCharactersOf(ODS_CONTENT),
    },
    build: () => buildOpenDocument('spreadsheet', ODS_CONTENT),
  },
  {
    answer: {
      fileName: 'odp-ja.odp',
      format: 'odp',
      mimeType: MIME_TYPES.odp,
      source:
        'benchmark/office-documents.ts: buildOpenDocument (test/fixtures/opendocument.ts)',
      features: [],
      expectedPages: SINGLE_PAGE,
      phrases: onPage(1, ['新製品発表会', '記者会見']),
      sourceCharacters: sourceCharactersOf(ODP_CONTENT),
    },
    build: () => buildOpenDocument('presentation', ODP_CONTENT),
  },
  {
    answer: {
      fileName: 'doc-legacy.doc',
      format: 'doc',
      mimeType: MIME_TYPES.doc,
      source:
        'copied from test/fixtures/legacy/simple-table.doc (Apache POI, Apache-2.0; see PROVENANCE.md there)',
      features: [],
      expectedPages: SINGLE_PAGE,
      phrases: onPage(1, ['Cell 2,3', 'This text is below the table.']),
    },
    build: () => readFileSync(LEGACY_DOC_PATH),
  },
  {
    answer: {
      fileName: 'ppt-legacy.ppt',
      format: 'ppt',
      mimeType: MIME_TYPES.ppt,
      source:
        'copied from test/fixtures/legacy/text_shapes.ppt (Apache POI, Apache-2.0; see PROVENANCE.md there)',
      features: [],
      expectedPages: SINGLE_PAGE,
      phrases: onPage(1, ['Title Placeholder', 'Text in a TextBox', 'Octagon']),
    },
    build: () => readFileSync(LEGACY_PPT_PATH),
  },
];
