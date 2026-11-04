import type { ExpectedPage } from './answers';
import {
  type ChromiumPdfDocument,
  MIME_TYPES,
  sourceCharactersOf,
} from './corpus-document';

// Japanese PDFs printed by Chromium from HTML with BIZ UDGothic embedded
// (design.md "Benchmark"). Each `pages` entry is one printed page; every line
// is short enough not to wrap, except in the line-break document, whose
// column fits exactly LINE_BREAK_COLUMN characters.

const SOURCE =
  'benchmark/pdf-documents.ts: HTML printed by Chromium (playwright-core) with BIZ UDGothic, via benchmark/render-pdf.ts';

const LINE_BREAK_COLUMN = 10;

const numberedPages = (count: number): ExpectedPage[] =>
  Array.from({ length: count }, (_, i) => ({
    pageNumber: i + 1,
    label: String(i + 1),
  }));

const paragraphs = (texts: readonly string[]): string =>
  texts.map((text) => `<p>${text}</p>`).join('');

// Each paragraph is given as its printed lines, so a reader can see where a
// word is cut; the HTML joins them and the narrow column re-creates the cut.
const LINE_BREAK_PARAGRAPHS: readonly (readonly string[])[] = [
  ['当社の新しい基幹シス', 'テムは来年度から本格', '稼働する予定である。'],
  ['移行作業では顧客管理', 'データベースの整合性', 'を慎重に確認する。'],
  ['問い合わせは情報シス', 'テム部の窓口で受け付', 'ける。'],
];

const DECLARED: readonly ChromiumPdfDocument[] = [
  {
    answer: {
      fileName: 'pdf-ja-horizontal.pdf',
      format: 'pdf',
      mimeType: MIME_TYPES.pdf,
      source: SOURCE,
      features: ['horizontal-writing'],
      expectedPages: numberedPages(3),
      phrases: [
        { text: '情報セキュリティ基本方針', page: 1 },
        { text: 'ISO/IEC 27001', page: 1 },
        { text: '機密情報', page: 1 },
        { text: '個人情報保護', page: 2 },
        { text: '利用目的', page: 2 },
        { text: '委託先の監督', page: 2 },
        { text: 'インシデント対応手順', page: 3 },
        { text: '不正アクセス', page: 3 },
        { text: 'CSIRT', page: 3 },
      ],
    },
    style: '.page { font-size: 14px; }',
    pages: [
      '<h1>情報セキュリティ基本方針</h1>' +
        paragraphs([
          '当社は ISO/IEC 27001 に基づき管理策を運用する。',
          '従業員は機密情報を適切に取り扱う。',
        ]),
      '<h2>個人情報保護</h2>' +
        paragraphs([
          '顧客の個人情報は利用目的の範囲内で取り扱う。',
          '委託先の監督を年1回実施する。',
        ]),
      '<h2>インシデント対応手順</h2>' +
        paragraphs([
          '不正アクセスを検知したら直ちに CSIRT へ報告する。',
          '報告を受けた担当者は影響範囲を調査する。',
        ]),
    ],
  },
  {
    answer: {
      fileName: 'pdf-ja-vertical.pdf',
      format: 'pdf',
      mimeType: MIME_TYPES.pdf,
      source: SOURCE,
      features: ['vertical-writing'],
      expectedPages: numberedPages(2),
      phrases: [
        { text: '社長挨拶', page: 1 },
        { text: '創業五十周年', page: 1 },
        { text: '地域社会', page: 1 },
        { text: '横浜市', page: 2 },
        { text: '株式会社に改組', page: 2 },
        { text: '本社を川崎市へ移転', page: 2 },
      ],
    },
    style:
      '.page { writing-mode: vertical-rl; height: 240mm; font-size: 16px; }',
    pages: [
      '<h1>社長挨拶</h1>' +
        paragraphs([
          '創業五十周年を迎えて',
          '皆様のご支援に心より感謝申し上げます。',
          '当社は地域社会とともに歩んでまいりました。',
        ]),
      '<h2>沿革</h2>' +
        paragraphs([
          '昭和五十年　横浜市にて創業',
          '平成十二年　株式会社に改組',
          '令和二年　本社を川崎市へ移転',
        ]),
    ],
  },
  {
    answer: {
      fileName: 'pdf-ja-line-break.pdf',
      format: 'pdf',
      mimeType: MIME_TYPES.pdf,
      source: SOURCE,
      features: ['horizontal-writing', 'line-break-inside-word'],
      expectedPages: numberedPages(1),
      phrases: [
        { text: '基幹システム', page: 1, lineBreakAfter: 4 },
        { text: '本格稼働', page: 1, lineBreakAfter: 2 },
        { text: '顧客管理データベース', page: 1, lineBreakAfter: 4 },
        { text: '整合性', page: 1 },
        { text: '情報システム部', page: 1, lineBreakAfter: 4 },
        { text: '窓口', page: 1 },
      ],
    },
    // A column a little wider than the line, so exactly that many
    // full-width characters fit; `anywhere` lets a line end inside a word.
    style: `.page p { width: ${LINE_BREAK_COLUMN + 0.5}em; font-size: 16px; line-break: anywhere; }`,
    pages: [paragraphs(LINE_BREAK_PARAGRAPHS.map((lines) => lines.join('')))],
  },
];

export const CHROMIUM_PDF_DOCUMENTS: readonly ChromiumPdfDocument[] =
  DECLARED.map((document) => ({
    ...document,
    answer: {
      ...document.answer,
      sourceCharacters: sourceCharactersOf(...document.pages),
    },
  }));
