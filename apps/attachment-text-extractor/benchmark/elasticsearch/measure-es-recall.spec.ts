import { createServer } from 'node:http';

import type { DocumentAnswer } from '../answers';
import { listIndices } from './es-client';
import { measureEsRecall, probeElasticsearch } from './measure-es-recall';

// Runs against a real Elasticsearch only when BENCHMARK_ES_URL names one
// (the devcontainer's is http://elasticsearch:9200), so CI without one skips.
const ES_URL = process.env.BENCHMARK_ES_URL;

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
    { text: '情報セキュリティ基本方針', page: 1 },
    { text: '基幹システム', page: 1 },
    { text: '個人情報保護', page: 2 },
  ],
};

const txtAnswer: DocumentAnswer = {
  fileName: 'b.txt',
  format: 'txt',
  mimeType: 'text/plain',
  source: 'hand-written',
  features: [],
  expectedPages: [{ pageNumber: null, label: null }],
  phrases: [{ text: '議事録', page: 1 }],
};

describe.runIf(ES_URL != null)('measureEsRecall against Elasticsearch', () => {
  const url = ES_URL ?? '';

  it('finds the kuromoji analyzer through the plugin list and _analyze', async () => {
    const probe = await probeElasticsearch(url);

    expect(probe.plugins.kuromoji).toBe(true);
    expect(probe.analyzeSample.length).toBeGreaterThan(1);
  });

  it('finds intact phrases at their element, misses a phrase cut apart, and deletes its index', async () => {
    const indexName = `benchmark-spec-${Date.now()}`;
    const { plugins } = await probeElasticsearch(url);

    const results = await measureEsRecall({
      url,
      indexName,
      plugins,
      documents: [
        {
          answer: pdfAnswer,
          outcome: {
            ok: true,
            pages: [
              {
                pageNumber: 1,
                label: '1',
                content:
                  '情報セキュリティ基本方針\n当社の新しい基幹シス テムは',
              },
              { pageNumber: 2, label: '2', content: '' },
            ],
          },
        },
        { answer: txtAnswer, outcome: { ok: false, reason: 'HTTP 500' } },
      ],
    });

    const kuromoji = results
      .filter((result) => result.variant === 'kuromoji-phrase')
      .map(({ format, page, elementIndexes }) => ({
        format,
        page,
        elementIndexes,
      }));
    expect(kuromoji).toEqual([
      { format: 'pdf', page: 1, elementIndexes: [1] },
      { format: 'pdf', page: 1, elementIndexes: [] },
      { format: 'pdf', page: 2, elementIndexes: [] },
      { format: 'txt', page: 1, elementIndexes: [] },
    ]);
    expect(await listIndices(url, 'benchmark-spec-*')).not.toContain(indexName);
  });
});

type Handler = Parameters<typeof createServer>[1];

// Runs the body against a stand-in Elasticsearch on a free local port.
const withStandIn = async (
  handler: Handler,
  body: (url: string) => Promise<void>,
): Promise<void> => {
  const es = createServer(handler);
  await new Promise<void>((resolve) => es.listen(0, '127.0.0.1', resolve));
  try {
    const address = es.address();
    if (address == null || typeof address === 'string') {
      throw new Error('the stand-in is not listening on a TCP port');
    }
    await body(`http://127.0.0.1:${address.port}`);
  } finally {
    es.closeAllConnections();
    await new Promise<void>((resolve) => es.close(() => resolve()));
  }
};

const reply = (
  res: Parameters<NonNullable<Handler>>[1],
  status: number,
  body: string,
) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
};

const failure = async (promise: Promise<unknown>): Promise<Error> => {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof Error)) {
    throw new Error('expected the promise to reject with an Error');
  }
  return error;
};

describe('measureEsRecall when Elasticsearch fails', () => {
  it('reports the failure that stopped it first, with the failure to delete the index after it', async () => {
    // Fails creating and deleting the index alike.
    await withStandIn(
      (req, res) =>
        reply(
          res,
          500,
          req.method === 'DELETE' ? 'delete-failed' : 'create-failed',
        ),
      async (url) => {
        const error = await failure(
          measureEsRecall({
            url,
            indexName: 'benchmark-spec',
            plugins: { kuromoji: true, icu: true },
            documents: [],
          }),
        );

        expect(error.message).toMatch(
          /^Elasticsearch PUT \S*: HTTP 500 create-failed/,
        );
        expect(error.message).toMatch(/delete-failed/);
        expect(error.cause).toBeInstanceOf(Error);
        if (!(error.cause instanceof Error)) return;
        expect(error.cause.message).toMatch(/create-failed/);
        expect(error.cause.message).not.toMatch(/delete-failed/);
      },
    );
  });

  it('fails when only deleting the index fails after a measurement that worked', async () => {
    // Creating, indexing and searching work; deleting the index fails.
    await withStandIn(
      (req, res) => {
        if (req.method === 'DELETE') {
          reply(res, 500, 'delete-failed');
        } else if (req.url?.includes('/_bulk')) {
          reply(res, 200, '{"errors":false}');
        } else if (req.url?.includes('/_search')) {
          reply(res, 200, '{"hits":{"hits":[{"_source":{"elementIndex":1}}]}}');
        } else {
          reply(res, 200, '{}');
        }
        req.resume();
      },
      async (url) => {
        const error = await failure(
          measureEsRecall({
            url,
            indexName: 'benchmark-spec',
            plugins: { kuromoji: true, icu: true },
            documents: [
              {
                answer: txtAnswer,
                outcome: {
                  ok: true,
                  pages: [{ pageNumber: null, label: null, content: '議事録' }],
                },
              },
            ],
          }),
        );

        expect(error.message).toMatch(
          /^Elasticsearch DELETE \S*: HTTP 500 delete-failed/,
        );
      },
    );
  });
});
