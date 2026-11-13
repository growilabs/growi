import {
  getPath,
  jsonOf,
  recordOf,
} from '../../src/http/spec-support/extract-client';
import { useBlackboxService } from './blackbox-service';
import { itNodeOnly } from './blackbox-target';

// Black box (research.md 22.7 `health`): /healthz and /readyz as the default
// service answers them, and no /docs or /redoc pages (D3). Python
// test_main.py (Healthz / Readyz / lifespan rows) and test_health.py.
// Not ready -> 503 and coming back from it need a stand-in runner, so they are
// in src/http/health-routes.integ.ts.

const service = useBlackboxService();

describe('GET /healthz', () => {
  it('is 200 {"status":"ok"} without a token', async () => {
    const answer = await getPath(service().url, '/healthz');

    expect(answer.status).toBe(200);
    expect(jsonOf(answer)).toEqual({ status: 'ok' });
  });

  it('ignores an invalid Authorization header', async () => {
    const answer = await getPath(service().url, '/healthz', 'wrong-token');

    expect(answer.status).toBe(200);
    expect(jsonOf(answer)).toEqual({ status: 'ok' });
  });
});

describe('GET /readyz', () => {
  it('is 200 "ready" without a token, every dependency "ok"', async () => {
    const answer = await getPath(service().url, '/readyz');

    expect(answer.status).toBe(200);
    const body = jsonOf(answer);
    expect(body.status).toBe('ready');
    expect(Object.values(recordOf(body.dependencies))).not.toHaveLength(0);
    for (const status of Object.values(recordOf(body.dependencies))) {
      expect(status).toBe('ok');
    }
  });

  it('collapses the internal modules into one "converter" entry', async () => {
    const body = jsonOf(await getPath(service().url, '/readyz'));

    expect(recordOf(body.dependencies).converter).toBe('ok');
  });

  it('names no internal module, path or PDF strategy', async () => {
    const answer = await getPath(service().url, '/readyz');

    expect(Object.keys(jsonOf(answer)).sort()).toEqual([
      'dependencies',
      'status',
    ]);
    expect(answer.text).not.toMatch(
      /child[_-]entry|app\.runner|src\/|\.ts|\.py|pdf_strategy|pdf_extraction_strategy/,
    );
  });

  itNodeOnly(
    'D2',
    'lists the real package names, prlimit and converter',
    async () => {
      const body = jsonOf(await getPath(service().url, '/readyz'));

      expect(Object.keys(recordOf(body.dependencies)).sort()).toEqual(
        [
          '@embedpdf/pdfium',
          '@firecrawl/anydoc',
          'converter',
          'prlimit',
        ].sort(),
      );
    },
  );
});

describe('no documentation pages (D3)', () => {
  itNodeOnly('D3', 'GET /docs with a token is not served', async () => {
    const { url, token } = service();

    expect((await getPath(url, '/docs', token)).status).toBe(404);
    // The token was good: the document such a page would show is served.
    expect((await getPath(url, '/openapi.json', token)).status).toBe(200);
  });

  itNodeOnly('D3', 'GET /redoc with a token is not served', async () => {
    const { url, token } = service();

    expect((await getPath(url, '/redoc', token)).status).toBe(404);
    // The token was good: the document such a page would show is served.
    expect((await getPath(url, '/openapi.json', token)).status).toBe(200);
  });
});
