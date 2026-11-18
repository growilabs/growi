import type { DocumentAnswer } from '../answers';
import type { ExtractedPage, ExtractOutcome } from '../extraction';
import { scoreDocument } from './score-document';

// Hand-made answers and service outputs: each expected value below is worked
// out by reading the example, not by running the scorer.

const pdfAnswer: DocumentAnswer = {
  fileName: 'a.pdf',
  format: 'pdf',
  mimeType: 'application/pdf',
  source: 'hand-written',
  features: ['line-break-inside-word'],
  expectedPages: [
    { pageNumber: 1, label: '1' },
    { pageNumber: 2, label: '2' },
  ],
  phrases: [
    { text: '情報セキュリティ', page: 1 },
    { text: '基幹システム', page: 1, lineBreakAfter: 4 },
    { text: '個人情報保護', page: 2 },
    { text: '利用目的', page: 2 },
  ],
  sourceCharacters: '情報セキュリティ基幹システム個人情報保護と利用目的',
};

const PERFECT_PDF_PAGES: readonly ExtractedPage[] = [
  { pageNumber: 1, label: '1', content: '情報セキュリティ\n基幹システム\n' },
  { pageNumber: 2, label: '2', content: '個人情報保護と利用目的\n' },
];

const FFFD = String.fromCodePoint(0xfffd);

const ok = (pages: readonly ExtractedPage[]): ExtractOutcome => ({
  ok: true,
  pages,
});

const withPage = (
  index: number,
  page: Partial<ExtractedPage>,
): readonly ExtractedPage[] =>
  PERFECT_PDF_PAGES.map((original, i) =>
    i === index ? { ...original, ...page } : original,
  );

const matches = (outcome: ExtractOutcome) =>
  scoreDocument(pdfAnswer, outcome).phrases.map((phrase) => phrase.match);

describe('scoreDocument', () => {
  it('scores an output that matches the answer as fully correct', () => {
    const score = scoreDocument(pdfAnswer, ok(PERFECT_PDF_PAGES));

    expect(score.failure).toBeNull();
    expect(score.phrases.map((phrase) => phrase.match)).toEqual([
      'exact',
      'exact',
      'exact',
      'exact',
    ]);
    expect(score.phrases.every((phrase) => phrase.atExpectedPosition)).toBe(
      true,
    );
    expect(score.pages).toEqual({
      expected: 2,
      actual: 2,
      elementsCorrect: 2,
      sheetNames: null,
    });
    expect(score.characters).toEqual({
      replacementCharacters: 0,
      unexpectedCharacters: 0,
      unexpectedSample: [],
    });
  });

  it('marks a phrase missing when the output lacks it', () => {
    expect(matches(ok(withPage(1, { content: '個人情報保護\n' })))).toEqual([
      'exact',
      'exact',
      'exact',
      'missing',
    ]);
  });

  it('marks a phrase split when whitespace falls inside it, apart from the printed line break', () => {
    const score = scoreDocument(
      pdfAnswer,
      ok(
        withPage(0, {
          content: '情報 セキュリティ\n基幹シス\nテム\n',
        }),
      ),
    );

    expect(score.phrases.map((phrase) => phrase.match)).toEqual([
      'split-elsewhere',
      'split-at-line-break',
      'exact',
      'exact',
    ]);
    // A split phrase is still found, so it is on its expected page.
    expect(score.phrases.map((phrase) => phrase.atExpectedPosition)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('counts replacement characters apart from other unexpected characters', () => {
    const score = scoreDocument(
      pdfAnswer,
      ok(withPage(1, { content: `個人情報保護と利用目的${FFFD}${FFFD}\n` })),
    );

    expect(score.characters).toEqual({
      replacementCharacters: 2,
      unexpectedCharacters: 0,
      unexpectedSample: [],
    });
  });

  it('counts characters the source does not hold, ignoring ASCII and whitespace', () => {
    // ⽇ is the Kangxi radical, not the ideograph 日; ã is Latin-1 mojibake.
    const score = scoreDocument(
      pdfAnswer,
      ok(withPage(1, { content: '個人情報保護と利用目的 ⽇ ã ã (OK)\t\n' })),
    );

    expect(score.characters).toEqual({
      replacementCharacters: 0,
      unexpectedCharacters: 3,
      unexpectedSample: ['⽇', 'ã'],
    });
  });

  it('counts control characters as unexpected even though they are ASCII', () => {
    const score = scoreDocument(
      pdfAnswer,
      ok(withPage(1, { content: '個人情報保護と利用目的\u0000\u0007\n' })),
    );

    expect(score.characters.unexpectedCharacters).toBe(2);
  });

  // JavaScript's \s includes U+FEFF; a byte order mark left in the text is
  // still a character the source does not hold.
  it('counts a byte order mark left in the output as unexpected', () => {
    const bom = String.fromCodePoint(0xfeff);
    const score = scoreDocument(
      pdfAnswer,
      ok(withPage(0, { content: `${bom}情報セキュリティ\n基幹システム\n` })),
    );

    expect(score.characters).toEqual({
      replacementCharacters: 0,
      unexpectedCharacters: 1,
      unexpectedSample: [bom],
    });
  });

  it('cannot count unexpected characters for a document without declared source characters', () => {
    const { sourceCharacters: _, ...withoutSource } = pdfAnswer;
    const score = scoreDocument(withoutSource, ok(PERFECT_PDF_PAGES));

    expect(score.characters.unexpectedCharacters).toBeNull();
  });

  it('marks a phrase found on another page as found but not at its expected position', () => {
    const score = scoreDocument(
      pdfAnswer,
      ok([
        { pageNumber: 1, label: '1', content: '情報セキュリティ\n' },
        {
          pageNumber: 2,
          label: '2',
          content: '基幹システム\n個人情報保護と利用目的\n',
        },
      ]),
    );

    expect(score.phrases[1]).toEqual({
      text: '基幹システム',
      page: 1,
      match: 'exact',
      matchAtExpectedPosition: 'missing',
      foundOnPages: [2],
      atExpectedPosition: false,
      foundOnOtherElements: true,
    });
  });

  // A page boundary that moved copies text into the next element too: a
  // search then hits the wrong page as well as the right one.
  it('marks a phrase found on its expected page and on another page as found elsewhere too', () => {
    const score = scoreDocument(
      pdfAnswer,
      ok([
        PERFECT_PDF_PAGES[0],
        {
          ...PERFECT_PDF_PAGES[1],
          content: '個人情報保護と利用目的\n基幹システム\n',
        },
      ]),
    );

    expect(score.phrases[1]).toMatchObject({
      foundOnPages: [1, 2],
      atExpectedPosition: true,
      foundOnOtherElements: true,
    });
    expect(score.phrases.map((phrase) => phrase.foundOnOtherElements)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it('judges the split on the expected element apart from the best match over all elements', () => {
    const score = scoreDocument(
      pdfAnswer,
      ok([
        {
          ...PERFECT_PDF_PAGES[0],
          content: '情報セキュリティ\n基幹シス\nテム\n',
        },
        {
          ...PERFECT_PDF_PAGES[1],
          content: '個人情報保護と利用目的\n基幹システム\n',
        },
      ]),
    );

    expect(score.phrases[1]).toMatchObject({
      match: 'exact',
      matchAtExpectedPosition: 'split-at-line-break',
      atExpectedPosition: true,
      foundOnOtherElements: true,
    });
  });

  it('reports a different number of pages, comparing the elements that exist in order', () => {
    const score = scoreDocument(
      pdfAnswer,
      ok([
        {
          pageNumber: 1,
          label: '1',
          content: '情報セキュリティ\n基幹システム\n個人情報保護と利用目的\n',
        },
      ]),
    );

    expect(score.pages).toEqual({
      expected: 2,
      actual: 1,
      elementsCorrect: 1,
      sheetNames: null,
    });
    expect(score.phrases.map((phrase) => phrase.atExpectedPosition)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('counts an element whose page number or label differs as incorrect', () => {
    const score = scoreDocument(
      pdfAnswer,
      ok([
        { ...PERFECT_PDF_PAGES[0], label: 'i' },
        { ...PERFECT_PDF_PAGES[1], pageNumber: null },
      ]),
    );

    expect(score.pages.elementsCorrect).toBe(0);
  });

  it('scores an empty extraction as nothing found', () => {
    const score = scoreDocument(pdfAnswer, ok([]));

    expect(score.failure).toBeNull();
    expect(score.phrases.map((phrase) => phrase.match)).toEqual([
      'missing',
      'missing',
      'missing',
      'missing',
    ]);
    expect(score.pages).toEqual({
      expected: 2,
      actual: 0,
      elementsCorrect: 0,
      sheetNames: null,
    });
  });

  it('scores a failed request as nothing found, keeping the reason', () => {
    const score = scoreDocument(pdfAnswer, {
      ok: false,
      reason: 'HTTP 500',
    });

    expect(score.failure).toBe('HTTP 500');
    expect(score.phrases.every((phrase) => phrase.match === 'missing')).toBe(
      true,
    );
    expect(score.pages.actual).toBeNull();
    expect(score.pages.elementsCorrect).toBe(0);
  });
});

describe('scoreDocument on an XLSX', () => {
  const xlsxAnswer: DocumentAnswer = {
    fileName: 'a.xlsx',
    format: 'xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    source: 'hand-written',
    features: [],
    expectedPages: [
      { pageNumber: 1, label: '売上', sheetName: '売上' },
      { pageNumber: 2, label: '顧客', sheetName: '顧客' },
    ],
    phrases: [
      { text: '売上高', page: 1 },
      { text: '中村', page: 2 },
    ],
  };

  it('counts the sheets whose name the element carries in its label or content', () => {
    const labelled = scoreDocument(
      xlsxAnswer,
      ok([
        { pageNumber: 1, label: '売上', content: '売上高' },
        { pageNumber: 2, label: '顧客', content: '中村' },
      ]),
    );
    const named = scoreDocument(
      xlsxAnswer,
      ok([
        { pageNumber: 1, label: '1', content: '## 売上\n売上高' },
        { pageNumber: 2, label: '2', content: '中村' },
      ]),
    );

    expect(labelled.pages.sheetNames).toEqual({ correct: 2, total: 2 });
    expect(labelled.pages.elementsCorrect).toBe(2);
    expect(named.pages.sheetNames).toEqual({ correct: 1, total: 2 });
    expect(named.pages.elementsCorrect).toBe(0);
  });
});

describe('scoreDocument on an HTML with script and style', () => {
  const htmlAnswer: DocumentAnswer = {
    fileName: 'a.html',
    format: 'html',
    mimeType: 'text/html',
    source: 'hand-written',
    features: ['script-style'],
    expectedPages: [{ pageNumber: null, label: null }],
    phrases: [{ text: '価格改定', page: 1 }],
    absentPhrases: ['スタイル定義', 'スクリプト内部の文字列'],
  };

  it('lists each phrase that must stay out but reached the output, even cut by whitespace', () => {
    const clean = scoreDocument(
      htmlAnswer,
      ok([{ pageNumber: null, label: null, content: '価格改定のお知らせ' }]),
    );
    const leaked = scoreDocument(
      htmlAnswer,
      ok([
        {
          pageNumber: null,
          label: null,
          content: '価格改定のお知らせ\nスクリプト 内部の文字列',
        },
      ]),
    );

    expect(clean.absentPhrases).toEqual({ total: 2, leaked: [] });
    expect(leaked.absentPhrases).toEqual({
      total: 2,
      leaked: ['スクリプト内部の文字列'],
    });
  });
});
