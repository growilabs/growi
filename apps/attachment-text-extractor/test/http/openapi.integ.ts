import {
  type Answer,
  getPath,
  jsonOf,
  postBody,
  postFile,
} from '../../src/http/spec-support/extract-client';
import { responseChecker } from '../openapi/openapi-support';
import { useBlackboxService } from './blackbox-service';

// Black box (research.md 22.7 `openapi`): Req 7.1 from outside. The service
// serves its document without a token, and real answers fit the schemas the
// served document gives (17.7 2 (iv)). Both hold for the Python service with
// its own document, so nothing here is Node only; what only the Node
// document says (the 7.2 facts) is checked in test/openapi/. Python
// test_main.py TestOpenApiIntegration / TestOpenApiRequestBody.

const service = useBlackboxService();

const served = async (): Promise<Record<string, unknown>> =>
  jsonOf(await getPath(service().url, '/openapi.json'));

describe('GET /openapi.json', () => {
  it('is 200 without a token, an OpenAPI 3.x document', async () => {
    const answer = await getPath(service().url, '/openapi.json');

    expect(answer.status).toBe(200);
    expect(String(jsonOf(answer).openapi)).toMatch(/^3\./);
  });
});

describe('answers fit the documented schemas (17.7 2 (iv))', () => {
  const fits = async (
    path: string,
    method: string,
    answer: Answer,
  ): Promise<void> => {
    const check = responseChecker(await served());
    expect(check(path, method, answer.status, JSON.parse(answer.text))).toEqual(
      [],
    );
  };

  it('200 from POST /extract', async () => {
    const { url, token } = service();
    const answer = await postFile(url, 'a.txt', 'こんにちは😀', { token });

    expect(answer.status).toBe(200);
    await fits('/extract', 'post', answer);
  });

  it('400 unsupported_format', async () => {
    const { url, token } = service();
    const answer = await postFile(url, 'a.zzz', 'x', { token });

    expect(answer.status).toBe(400);
    await fits('/extract', 'post', answer);
  });

  it('422 for a body that is not multipart', async () => {
    const { url, token } = service();
    const answer = await postBody(url, '{}', 'application/json', { token });

    expect(answer.status).toBe(422);
    await fits('/extract', 'post', answer);
  });

  it('401 without a token', async () => {
    const answer = await postFile(service().url, 'a.txt', 'x', { token: null });

    expect(answer.status).toBe(401);
    await fits('/extract', 'post', answer);
  });

  it.each(['/healthz', '/readyz'])('200 from GET %s', async (path) => {
    const answer = await getPath(service().url, path);

    expect(answer.status).toBe(200);
    await fits(path, 'get', answer);
  });
});
