import { callPath, getPath, jsonOf } from './spec-support/extract-client';
import { fakeRunner } from './spec-support/fake-runner';
import { startTestService, useTestService } from './spec-support/test-service';

// GET /openapi.json serves the document generated from the route definitions
// (research.md 17.13), and there are no /docs or /redoc pages (D3). Python
// test_main.py TestOpenApiIntegration. What the document says is checked in
// test/openapi/.

const service = useTestService(() => ({ runner: fakeRunner() }));

describe('GET /openapi.json', () => {
  it('serves an OpenAPI 3.1 document as JSON, without a token', async () => {
    const answer = await getPath(service.current().url, '/openapi.json');

    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toMatch(/^application\/json/);
    expect(jsonOf(answer).openapi).toBe('3.1.0');
  });

  // The generator keeps state at module level; apps built in one process
  // (the tests build many) must not see each other's routes.
  it('serves the same document on every request and from every app', async () => {
    const { url } = service.current();
    const other = await startTestService(fakeRunner(), {
      MAX_FILE_SIZE_MB: '1',
    });
    try {
      const [first, second, fromOther] = await Promise.all([
        getPath(url, '/openapi.json'),
        getPath(url, '/openapi.json'),
        getPath(other.url, '/openapi.json'),
      ]);

      expect(jsonOf(second)).toStrictEqual(jsonOf(first));
      expect(jsonOf(fromOther)).toStrictEqual(jsonOf(first));
    } finally {
      await other.close();
    }
  });
});

describe('no documentation pages (D3)', () => {
  it.each([
    '/docs',
    '/redoc',
    '/docs/oauth2-redirect',
  ])('GET %s is 404 with a token and 401 without', async (path) => {
    const { url, token } = service.current();

    expect((await callPath(url, 'GET', path, token)).status).toBe(404);
    expect((await callPath(url, 'GET', path, null)).status).toBe(401);
  });
});
