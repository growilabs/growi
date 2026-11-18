import type { DocumentAnswer } from './answers';
import type { BenchmarkReport } from './benchmark-run';
import { renderMarkdownReport } from './report-markdown';
import { scoreDocument, summarizeAll, summarizeByFormat } from './scoring';

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

// Of 6 phrases, 3 are found as written and 1 more only once whitespace is
// ignored; the third document failed.
const documents = [
  scoreDocument(
    txtAnswer('a.txt', ['議事録', '山田太郎']),
    single('議事録 山田太郎'),
  ),
  scoreDocument(
    txtAnswer('b.txt', ['障害報告書', '接続プール']),
    single('障害報告書 接続 プール'),
  ),
  scoreDocument(txtAnswer('c.txt', ['年末年始', '営業開始']), {
    ok: false,
    reason: 'HTTP 503',
  }),
];

const report: BenchmarkReport = {
  label: 'python',
  service: 'http://127.0.0.1:18000/',
  startedAt: '2026-11-04T00:00:00.000Z',
  finishedAt: '2026-11-04T00:00:05.000Z',
  corpus: [
    {
      fileName: 'pdf-ja-horizontal.pdf',
      format: 'pdf',
      bytes: 26012,
      sha256:
        '8a757369271d0348202f5df3c9822d41a74ab3603a46752715d4628f49411a13',
    },
    { fileName: 'a.txt', format: 'txt', bytes: 10, sha256: '00' },
  ],
  formats: summarizeByFormat(documents),
  total: summarizeAll(documents),
  documents,
  elasticsearch: {
    status: 'skipped',
    reason: 'no Elasticsearch URL was given',
  },
};

const rowOf = (markdown: string, heading: string, first: string): string[] => {
  const section = markdown
    .split(/^#+ /m)
    .find((part) => part.startsWith(heading));
  const row = section
    ?.split('\n')
    .find((line) => line.startsWith(`| ${first} |`));
  return (row ?? '')
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
};

describe('renderMarkdownReport', () => {
  const markdown = renderMarkdownReport(report);

  it('heads the report with the label, the times and the service', () => {
    expect(markdown).toContain('python');
    expect(markdown).toContain('2026-11-04T00:00:00.000Z');
    expect(markdown).toContain('http://127.0.0.1:18000/');
  });

  it('shows recall as written and with whitespace ignored, per format, with the failures', () => {
    expect(rowOf(markdown, '(a)', 'txt')).toEqual([
      'txt',
      '3',
      '1',
      '6',
      '3/6 (50.0%)',
      '4/6 (66.7%)',
    ]);
  });

  it('shows the split and character counts per format, the splits also on the expected element alone', () => {
    expect(rowOf(markdown, '(c)', 'txt')).toEqual([
      'txt',
      '0',
      '0',
      '0',
      '1',
      '0',
      '1',
      '0/0',
    ]);
  });

  it('shows the phrases found at their position and also elsewhere', () => {
    expect(rowOf(markdown, '(b)', 'txt')).toEqual([
      'txt',
      '2/3 (66.7%)',
      '2/3 (66.7%)',
      '—',
      '4/6 (66.7%)',
      '0',
      '0',
    ]);
  });

  it('lists the SHA-256 of the corpus PDFs', () => {
    expect(markdown).toContain(
      '8a757369271d0348202f5df3c9822d41a74ab3603a46752715d4628f49411a13',
    );
  });

  it('says that Elasticsearch was not measured, and why', () => {
    expect(markdown).toContain('no Elasticsearch URL was given');
  });

  it('names the Elasticsearch column for hits outside the expected element by what it counts', () => {
    const measured = renderMarkdownReport({
      ...report,
      elasticsearch: {
        status: 'measured',
        url: 'http://elasticsearch:9200/',
        plugins: { kuromoji: true, icu: true },
        analyzeSample: ['基幹', 'システム'],
        indexName: 'benchmark-spec',
        recall: [
          {
            format: 'txt',
            variant: 'kuromoji-phrase',
            phrases: 6,
            documentFound: 4,
            positionFound: 3,
            extraElementHits: 1,
          },
        ],
        positionProblems: [],
      },
    });

    expect(rowOf(measured, '(d)', '形式')).toContain(
      '正解以外の位置に当たった',
    );
    expect(rowOf(measured, '(d)', 'txt')).toEqual([
      'txt',
      'kuromoji-phrase',
      '6',
      '4/6 (66.7%)',
      '3/6 (50.0%)',
      '1',
    ]);
  });
});
