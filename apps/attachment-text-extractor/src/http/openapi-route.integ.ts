import {
  DESCRIPTION_FIXES,
  readCommittedOpenApi,
  textAt,
  withoutDescriptions,
} from '../../test/openapi/openapi-support';
import { openApiDocument } from './openapi-route';
import { callPath, getPath, jsonOf } from './spec-support/extract-client';
import { fakeRunner } from './spec-support/fake-runner';
import { useTestService } from './spec-support/test-service';

// GET /openapi.json serves the service-owned document as it is (research.md
// 17.1), and there are no /docs or /redoc pages (D3). Python test_main.py
// TestOpenApiIntegration. The drift and code-vs-document checks are in
// test/openapi/.

const service = useTestService(() => ({ runner: fakeRunner() }));

describe('GET /openapi.json', () => {
  it('serves the service document, without a token', async () => {
    const answer = await getPath(service.current().url, '/openapi.json');

    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toMatch(/^application\/json/);
    expect(jsonOf(answer)).toEqual(JSON.parse(JSON.stringify(openApiDocument)));
    expect(Object.keys(jsonOf(answer)).sort()).toEqual([
      'components',
      'info',
      'openapi',
      'paths',
    ]);
  });

  it('is the committed client document with only the 7.1 descriptions rewritten', async () => {
    const served = jsonOf(
      await getPath(service.current().url, '/openapi.json'),
    );

    expect(withoutDescriptions(served)).toStrictEqual(
      withoutDescriptions(readCommittedOpenApi()),
    );
    for (const { pointer, after } of DESCRIPTION_FIXES) {
      expect(textAt(served, pointer), pointer.join(' > ')).toBe(after);
    }
    expect(JSON.stringify(served)).not.toMatch(
      /forkserver|BearerAuthMiddleware|FastAPI|Extends str|len\(|``|\bNone\b/,
    );
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
