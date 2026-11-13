import {
  callPath,
  errorOf,
  getPath,
  jsonOf,
  postFile,
} from './spec-support/extract-client';
import { fakeRunner } from './spec-support/fake-runner';
import { useTestService } from './spec-support/test-service';

// Req 1.6 / 3.3 on the HTTP layer with a stand-in runner: the token is checked
// before anything else, on every path but /healthz, /readyz and /openapi.json.
// Python test_bearer_auth.py (its 3 import checks have no Node counterpart)
// and test_main.py's TestExtractAuthIntegration.

let runner = fakeRunner();

// What each open path answers, so a service that answers 200 to everything fails.
const OPEN_BODY: Readonly<Record<string, readonly [string, string]>> = {
  '/healthz': ['status', 'ok'],
  '/readyz': ['status', 'ready'],
  '/openapi.json': ['openapi', '3.1.0'],
};

const service = useTestService(() => {
  runner = fakeRunner();
  return { runner };
});

describe('POST /extract and the Bearer token', () => {
  it('the right token reaches the conversion', async () => {
    const { url, token } = service.current();

    const answer = await postFile(url, 'a.txt', 'hello', { token });

    expect(answer.status).toBe(200);
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no Authorization header', undefined],
    ['a wrong token', 'Bearer wrong-token'],
    ['Bearer with no token', 'Bearer '],
    ['another scheme', 'Basic {token}'],
    ['the token with one more character', 'Bearer {token}x'],
    ['a prefix of the token', 'Bearer {prefix}'],
    ['the token in another case', 'Bearer {upper}'],
  ])('%s is 401 unauthorized and never reaches the conversion', async (_case, header) => {
    const { url, token } = service.current();
    const authorization = header
      ?.replace('{token}', token)
      .replace('{prefix}', token.slice(0, -1))
      .replace('{upper}', token.toUpperCase());

    const answer = await postFile(url, 'a.txt', 'hello', {
      token: null,
      authorization,
    });

    expect(answer.status).toBe(401);
    expect(errorOf(answer).code).toBe('unauthorized');
    expect(errorOf(answer).message).not.toBe('');
    expect(errorOf(answer).keys).toEqual(['code', 'message']);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('the three paths open without a token (Req 1.6)', () => {
  it.each([
    '/healthz',
    '/readyz',
    '/openapi.json',
  ])('GET %s is 200 without a token', async (path) => {
    const answer = await getPath(service.current().url, path);
    const [key, value] = OPEN_BODY[path] ?? [];

    expect(answer.status).toBe(200);
    expect(key === undefined ? undefined : jsonOf(answer)[key]).toBe(value);
  });

  it.each([
    ['GET', '/'],
    ['GET', '/nonexistent'],
    ['DELETE', '/nonexistent'],
    ['GET', '/healthz/'],
    ['GET', '/readyz.json'],
    ['GET', '/openapi.json/x'],
    ['POST', '/extract/'],
  ])('%s %s without a token is 401', async (method, path) => {
    const answer = await callPath(service.current().url, method, path, null);

    expect(answer.status).toBe(401);
    expect(errorOf(answer).code).toBe('unauthorized');
  });

  it('an unknown path with the token is 404, not 401', async () => {
    const { url, token } = service.current();

    expect((await callPath(url, 'GET', '/nonexistent', token)).status).toBe(
      404,
    );
  });
});
