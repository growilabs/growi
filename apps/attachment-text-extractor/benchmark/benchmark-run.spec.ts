import { createServer } from 'node:http';

import { BENCHMARK_CORPUS_DIR, loadBenchmarkAnswers } from './answers';
import { runBenchmark } from './benchmark-run';
import {
  jsonReply,
  type StubExtractor,
  startStubExtractor,
} from './spec-support';

const TOKEN = 'spec-token-91ab';
const PICKED = ['pdf-ja-horizontal.pdf', 'txt-utf-8.txt', 'csv-utf-8.csv'];

const answers = {
  version: 1 as const,
  documents: loadBenchmarkAnswers().documents.filter((document) =>
    PICKED.includes(document.fileName),
  ),
};

// The text of txt-utf-8.txt (benchmark/text-documents.ts), as a correct
// extraction returns it.
const TXT_CONTENT =
  'GROWI 運用手順書\n毎日午前3時にバックアップを取得する。\n' +
  '全文検索には Elasticsearch を使用する。\n' +
  '障害時はオンコール担当者へ Slack で連絡する。\n';

describe('runBenchmark', () => {
  let stub: StubExtractor;

  beforeEach(async () => {
    stub = await startStubExtractor();
    stub.setReply(
      jsonReply(200, {
        pages: [{ pageNumber: null, label: null, content: TXT_CONTENT }],
      }),
      'txt-utf-8.txt',
    );
    stub.setReply(
      jsonReply(500, { code: 'internal_error', message: 'boom' }),
      'csv-utf-8.csv',
    );
  });

  afterEach(async () => {
    await stub.close();
  });

  const run = (esUrl?: string) =>
    runBenchmark({
      answers,
      corpusDir: BENCHMARK_CORPUS_DIR,
      endpoint: { baseUrl: stub.baseUrl, token: TOKEN, timeoutMs: 5000 },
      label: 'stub',
      now: () => new Date('2026-11-04T00:00:00Z'),
      ...(esUrl == null
        ? {}
        : { elasticsearch: { url: esUrl, indexName: 'benchmark-spec' } }),
    });

  it('sends every corpus document once, with the MIME type its answer names', async () => {
    await run();

    const sent = stub.received.map(({ form }) => {
      const file = form.get('file');
      return file instanceof File ? [file.name, file.type] : null;
    });
    expect(sent).toEqual([
      ['pdf-ja-horizontal.pdf', 'application/pdf'],
      ['txt-utf-8.txt', 'text/plain'],
      ['csv-utf-8.csv', 'text/csv'],
    ]);
  });

  it('scores the documents it got back and counts a failed request as a failure without stopping', async () => {
    const report = await run();
    const byFormat = new Map(report.formats.map((f) => [f.format, f]));

    expect(
      report.documents.map(({ fileName, failure }) => [fileName, failure]),
    ).toEqual([
      ['pdf-ja-horizontal.pdf', null],
      ['txt-utf-8.txt', null],
      ['csv-utf-8.csv', 'HTTP 500 (internal_error)'],
    ]);
    expect(byFormat.get('txt')).toMatchObject({ phrases: 5, exact: 5 });
    expect(byFormat.get('csv')).toMatchObject({
      documents: 1,
      failed: 1,
      phrases: 6,
      found: 0,
    });
    // The stub's default reply is an empty pages[].
    expect(byFormat.get('pdf')).toMatchObject({
      phrases: 9,
      found: 0,
      pageCountCorrect: 0,
    });
  });

  it('records the label, the time, and the SHA-256 of each corpus file', async () => {
    const report = await run();

    expect(report.label).toBe('stub');
    expect(report.startedAt).toBe('2026-11-04T00:00:00.000Z');
    // The value research.md 11.6 recorded for the committed PDF.
    expect(
      report.corpus.find((file) => file.fileName === 'pdf-ja-horizontal.pdf')
        ?.sha256,
    ).toBe('8a757369271d0348202f5df3c9822d41a74ab3603a46752715d4628f49411a13');
  });

  it('skips Elasticsearch when no URL is given', async () => {
    expect((await run()).elasticsearch).toEqual({
      status: 'skipped',
      reason: 'no Elasticsearch URL was given',
    });
  });

  it('skips Elasticsearch it cannot reach, and still scores the extraction', async () => {
    const report = await run('http://127.0.0.1:1');

    expect(report.elasticsearch.status).toBe('skipped');
    if (report.elasticsearch.status !== 'skipped') return;
    expect(report.elasticsearch.reason).toMatch(/^Elasticsearch failed/);
    expect(report.formats.find((f) => f.format === 'txt')).toMatchObject({
      phrases: 5,
      exact: 5,
    });
  });

  it('skips Elasticsearch without the kuromoji plugin, saying so', async () => {
    // An Elasticsearch stand-in whose plugin list is empty.
    const es = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('[]');
    });
    await new Promise<void>((resolve) => es.listen(0, '127.0.0.1', resolve));
    const address = es.address();
    try {
      if (address == null || typeof address === 'string') {
        throw new Error('the stand-in is not listening on a TCP port');
      }
      const report = await run(`http://127.0.0.1:${address.port}`);

      expect(report.elasticsearch).toEqual({
        status: 'skipped',
        reason: 'Elasticsearch has no analysis-kuromoji plugin',
      });
    } finally {
      es.closeAllConnections();
      await new Promise<void>((resolve) => es.close(() => resolve()));
    }
  });

  it('keeps the token out of the report', async () => {
    expect(JSON.stringify(await run())).not.toContain(TOKEN);
  });
});
