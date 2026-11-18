import type { DocumentAnswer } from '../answers';
import { scoreDocument } from './score-document';
import { summarizeAll, summarizeByFormat } from './summarize';

const txtAnswer = (fileName: string, phrases: string[]): DocumentAnswer => ({
  fileName,
  format: 'txt',
  mimeType: 'text/plain',
  source: 'hand-written',
  features: [],
  expectedPages: [{ pageNumber: null, label: null }],
  phrases: phrases.map((text) => ({ text, page: 1 })),
  sourceCharacters: phrases.join(''),
});

const single = (content: string) => ({
  ok: true as const,
  pages: [{ pageNumber: null, label: null, content }],
});

const pdfAnswer: DocumentAnswer = {
  fileName: 'a.pdf',
  format: 'pdf',
  mimeType: 'application/pdf',
  source: 'hand-written',
  features: [],
  expectedPages: [
    { pageNumber: 1, label: '1' },
    { pageNumber: 2, label: '2' },
  ],
  phrases: [
    { text: '基本方針', page: 1 },
    { text: '利用目的', page: 2 },
  ],
};

// Three TXT documents: one perfect, one with a split phrase and a U+FFFD,
// one whose request failed; and one PDF with a phrase on the wrong page.
const scores = [
  scoreDocument(
    txtAnswer('a.txt', ['議事録', '山田太郎']),
    single('議事録 山田太郎'),
  ),
  scoreDocument(
    txtAnswer('b.txt', ['障害報告書', '接続プール']),
    single(`障害報告書 接続 プール${String.fromCodePoint(0xfffd)}`),
  ),
  scoreDocument(txtAnswer('c.txt', ['年末年始', '営業開始']), {
    ok: false,
    reason: 'HTTP 503',
  }),
  scoreDocument(pdfAnswer, {
    ok: true,
    pages: [
      { pageNumber: 1, label: '1', content: '基本方針 利用目的' },
      { pageNumber: 2, label: '2', content: '' },
    ],
  }),
];

describe('summarizeByFormat', () => {
  it('adds up each format, counting a failed document phrases as not found', () => {
    const [pdf, txt] = summarizeByFormat(scores);

    expect(txt).toEqual({
      format: 'txt',
      documents: 3,
      failed: 1,
      phrases: 6,
      exact: 3,
      found: 4,
      splitAtLineBreak: 0,
      splitElsewhere: 1,
      splitAtLineBreakAtPosition: 0,
      splitElsewhereAtPosition: 1,
      pageCountCorrect: 2,
      pageElements: 3,
      pageElementsCorrect: 2,
      sheetNames: null,
      atExpectedPosition: 4,
      foundOnlyElsewhere: 0,
      alsoFoundElsewhere: 0,
      replacementCharacters: 1,
      unexpectedCharacters: 0,
      absentPhrases: 0,
      absentPhrasesLeaked: 0,
    });
    expect(pdf).toEqual({
      format: 'pdf',
      documents: 1,
      failed: 0,
      phrases: 2,
      exact: 2,
      found: 2,
      splitAtLineBreak: 0,
      splitElsewhere: 0,
      splitAtLineBreakAtPosition: 0,
      splitElsewhereAtPosition: 0,
      pageCountCorrect: 1,
      pageElements: 2,
      pageElementsCorrect: 2,
      sheetNames: null,
      atExpectedPosition: 1,
      foundOnlyElsewhere: 1,
      alsoFoundElsewhere: 0,
      replacementCharacters: 0,
      unexpectedCharacters: null,
      absentPhrases: 0,
      absentPhrasesLeaked: 0,
    });
  });

  it('lists formats in the order of BENCHMARK_FORMATS, and only those measured', () => {
    expect(summarizeByFormat(scores).map((summary) => summary.format)).toEqual([
      'pdf',
      'txt',
    ]);
  });
});

describe('summarizeByFormat on a phrase that is on its page and elsewhere', () => {
  it('counts it as also found elsewhere, and its split on the expected element apart from the best match', () => {
    const lineBreakAnswer: DocumentAnswer = {
      ...pdfAnswer,
      phrases: [
        { text: '基幹システム', page: 1, lineBreakAfter: 4 },
        { text: '利用目的', page: 2 },
      ],
    };
    const [pdf] = summarizeByFormat([
      scoreDocument(lineBreakAnswer, {
        ok: true,
        pages: [
          { pageNumber: 1, label: '1', content: '基幹シス\nテム' },
          { pageNumber: 2, label: '2', content: '基幹システム 利用目的' },
        ],
      }),
    ]);

    expect(pdf).toMatchObject({
      exact: 2,
      atExpectedPosition: 2,
      foundOnlyElsewhere: 0,
      alsoFoundElsewhere: 1,
      splitAtLineBreak: 0,
      splitAtLineBreakAtPosition: 1,
      splitElsewhereAtPosition: 0,
    });
  });
});

describe('summarizeAll', () => {
  it('adds up every document', () => {
    const all = summarizeAll(scores);

    expect(all.format).toBe('all');
    expect(all.documents).toBe(4);
    expect(all.phrases).toBe(8);
    expect(all.exact).toBe(5);
    expect(all.found).toBe(6);
    expect(all.atExpectedPosition).toBe(5);
    expect(all.unexpectedCharacters).toBe(0);
  });
});
