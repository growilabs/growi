import {
  bulkBody,
  type EsPhraseResult,
  esPositionProblems,
  esRecallAll,
  esRecallByFormat,
  hitElementIndexes,
  indexBody,
  parsePlugins,
  phraseQuery,
} from './es-queries';

describe('parsePlugins', () => {
  it('reads which analysis plugins the cluster has from _cat/plugins?format=json', () => {
    expect(
      parsePlugins([
        { name: 'node-1', component: 'analysis-kuromoji', version: '9.3.3' },
        { name: 'node-1', component: 'repository-s3', version: '9.3.3' },
      ]),
    ).toEqual({ kuromoji: true, icu: false });
    expect(
      parsePlugins([
        { name: 'node-1', component: 'analysis-icu', version: '9.3.3' },
        { name: 'node-1', component: 'analysis-kuromoji', version: '9.3.3' },
      ]),
    ).toEqual({ kuromoji: true, icu: true });
    expect(parsePlugins([])).toEqual({ kuromoji: false, icu: false });
  });

  it('rejects a body that is not the plugin list', () => {
    expect(() => parsePlugins({ error: 'x' })).toThrow();
  });
});

describe('indexBody', () => {
  it("analyzes content.ja with GROWI's kuromoji analyzer, ICU normalizer included when the plugin is there", () => {
    const body = indexBody({ kuromoji: true, icu: true });

    expect(body.settings.analysis.analyzer.japanese).toEqual({
      type: 'custom',
      tokenizer: 'kuromoji_tokenizer',
      char_filter: ['icu_normalizer'],
    });
    expect(body.mappings.properties.content).toEqual({
      type: 'text',
      fields: { ja: { type: 'text', analyzer: 'japanese' } },
    });
  });

  it('leaves the ICU normalizer out when the plugin is missing', () => {
    expect(
      indexBody({ kuromoji: true, icu: false }).settings.analysis.analyzer
        .japanese,
    ).toEqual({ type: 'custom', tokenizer: 'kuromoji_tokenizer' });
  });
});

describe('bulkBody', () => {
  it('indexes each pages[] element as its own document, numbered from 1', () => {
    const lines = bulkBody([
      {
        fileName: 'a.pdf',
        pages: [
          { pageNumber: 1, label: '1', content: '基本方針' },
          { pageNumber: 2, label: '2', content: '利用目的' },
        ],
      },
      {
        fileName: 'b.txt',
        pages: [{ pageNumber: null, label: null, content: '議事録' }],
      },
    ])
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(lines).toEqual([
      { index: {} },
      { fileName: 'a.pdf', elementIndex: 1, content: '基本方針' },
      { index: {} },
      { fileName: 'a.pdf', elementIndex: 2, content: '利用目的' },
      { index: {} },
      { fileName: 'b.txt', elementIndex: 1, content: '議事録' },
    ]);
  });

  it('ends with a newline, as the _bulk API requires', () => {
    expect(
      bulkBody([
        {
          fileName: 'b.txt',
          pages: [{ pageNumber: null, label: null, content: 'x' }],
        },
      ]).endsWith('\n'),
    ).toBe(true);
  });
});

describe('phraseQuery', () => {
  it('searches content.ja as a kuromoji phrase within the one document', () => {
    expect(phraseQuery('kuromoji-phrase', 'a.pdf', '基幹システム')).toEqual({
      size: 100,
      _source: ['elementIndex'],
      query: {
        bool: {
          must: [{ match_phrase: { 'content.ja': '基幹システム' } }],
          filter: [{ term: { fileName: 'a.pdf' } }],
        },
      },
    });
  });

  it("searches content as a phrase, as GROWI's quoted search does", () => {
    expect(
      phraseQuery('growi-quoted-phrase', 'a.pdf', '基幹システム').query.bool
        .must,
    ).toEqual([{ match_phrase: { content: '基幹システム' } }]);
  });
});

describe('hitElementIndexes', () => {
  it('lists the element numbers of the hits', () => {
    expect(
      hitElementIndexes({
        hits: {
          hits: [
            { _source: { elementIndex: 2 } },
            { _source: { elementIndex: 1 } },
          ],
        },
      }),
    ).toEqual([2, 1]);
  });

  it('rejects a body that is not a search response', () => {
    expect(() => hitElementIndexes({ error: { type: 'x' } })).toThrow();
  });
});

const RESULTS: readonly EsPhraseResult[] = [
  {
    fileName: 'a.pdf',
    text: '語句1',
    format: 'pdf',
    variant: 'kuromoji-phrase',
    page: 1,
    elementIndexes: [1],
  },
  {
    fileName: 'a.pdf',
    text: '語句2',
    format: 'pdf',
    variant: 'kuromoji-phrase',
    page: 2,
    elementIndexes: [1],
  },
  {
    fileName: 'a.pdf',
    text: '語句3',
    format: 'pdf',
    variant: 'kuromoji-phrase',
    page: 2,
    elementIndexes: [],
  },
  {
    fileName: 'b.txt',
    text: '語句4',
    format: 'txt',
    variant: 'kuromoji-phrase',
    page: 1,
    elementIndexes: [1],
  },
  {
    fileName: 'a.pdf',
    text: '語句5',
    format: 'pdf',
    variant: 'growi-quoted-phrase',
    page: 1,
    elementIndexes: [],
  },
];

describe('esRecallByFormat', () => {
  it('counts, per format and query, the phrases found in the document and those found at their position', () => {
    const recall = esRecallByFormat(RESULTS);

    expect(recall).toEqual([
      {
        format: 'pdf',
        variant: 'kuromoji-phrase',
        phrases: 3,
        documentFound: 2,
        positionFound: 1,
        extraElementHits: 1,
      },
      {
        format: 'txt',
        variant: 'kuromoji-phrase',
        phrases: 1,
        documentFound: 1,
        positionFound: 1,
        extraElementHits: 0,
      },
      {
        format: 'pdf',
        variant: 'growi-quoted-phrase',
        phrases: 1,
        documentFound: 0,
        positionFound: 0,
        extraElementHits: 0,
      },
    ]);
  });
});

describe('esRecallAll', () => {
  it('counts every format together, per query', () => {
    expect(esRecallAll(RESULTS)).toEqual([
      {
        format: 'all',
        variant: 'kuromoji-phrase',
        phrases: 4,
        documentFound: 3,
        positionFound: 2,
        extraElementHits: 1,
      },
      {
        format: 'all',
        variant: 'growi-quoted-phrase',
        phrases: 1,
        documentFound: 0,
        positionFound: 0,
        extraElementHits: 0,
      },
    ]);
  });
});

// A phrase found at its element and also at another one: a search for it
// also lands on the wrong page.
const ALSO_ELSEWHERE: readonly EsPhraseResult[] = [
  {
    fileName: 'a.pdf',
    text: '両方',
    format: 'pdf',
    variant: 'kuromoji-phrase',
    page: 1,
    elementIndexes: [1, 2],
  },
  {
    fileName: 'a.pdf',
    text: '正しい',
    format: 'pdf',
    variant: 'kuromoji-phrase',
    page: 1,
    elementIndexes: [1],
  },
  {
    fileName: 'a.pdf',
    text: '別だけ',
    format: 'pdf',
    variant: 'kuromoji-phrase',
    page: 2,
    elementIndexes: [1],
  },
];

describe('esRecallByFormat on hits outside the expected element', () => {
  it('counts a phrase that also hits another element apart from the position recall', () => {
    expect(esRecallByFormat(ALSO_ELSEWHERE)).toEqual([
      {
        format: 'pdf',
        variant: 'kuromoji-phrase',
        phrases: 3,
        documentFound: 3,
        positionFound: 2,
        extraElementHits: 2,
      },
    ]);
  });
});

describe('esPositionProblems', () => {
  it('lists each phrase a query did not find at its position, with where it was found', () => {
    expect(esPositionProblems(RESULTS)).toEqual([
      {
        fileName: 'a.pdf',
        text: '語句2',
        variant: 'kuromoji-phrase',
        page: 2,
        elementIndexes: [1],
      },
      {
        fileName: 'a.pdf',
        text: '語句3',
        variant: 'kuromoji-phrase',
        page: 2,
        elementIndexes: [],
      },
      {
        fileName: 'a.pdf',
        text: '語句5',
        variant: 'growi-quoted-phrase',
        page: 1,
        elementIndexes: [],
      },
    ]);
  });

  it('also lists a phrase found at its position that hit another element too', () => {
    expect(
      esPositionProblems(ALSO_ELSEWHERE).map((problem) => problem.text),
    ).toEqual(['両方', '別だけ']);
  });
});
