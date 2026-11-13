import {
  callPath,
  errorOf,
  extractedOf,
  getPath,
  jsonOf,
  postFile,
} from '../../src/http/spec-support/extract-client';
import {
  bodyTail,
  fileHead,
  multipartContentType,
} from '../../src/http/spec-support/multipart';
import {
  openConnection,
  requestHead,
} from '../../src/http/spec-support/raw-http';
import { useBlackboxService } from './blackbox-service';

// Black box (research.md 22.7 `auth`): Req 1.6, only /healthz, /readyz and
// /openapi.json answer without a token; every other path, unknown ones
// included, is 401 before anything else happens. Python test_integration_auth.py
// and the "missing or invalid token" rows of test_e2e_http.py.

const service = useBlackboxService();
// What each open path answers, so a service that answers 200 to everything fails.
const OPEN_BODY: Readonly<Record<string, readonly [string, string]>> = {
  '/healthz': ['status', 'ok'],
  '/readyz': ['status', 'ready'],
  '/openapi.json': ['openapi', '3.1.0'],
};
const MIB = 1024 * 1024;

describe('POST /extract authentication', () => {
  it('a valid token reaches the extraction', async () => {
    const { url, token } = service();

    const answer = await postFile(url, 'hello.txt', 'hello world', { token });

    expect(extractedOf(answer).pages[0]?.content).toBe('hello world');
  });

  it.each([
    ['no Authorization header', undefined, null],
    ['a wrong token', 'Bearer wrong-token-value', null],
    ['an empty Bearer token', 'Bearer ', null],
    ['the Basic scheme', 'Basic', 'token'],
    ['a lower-case scheme', 'bearer', 'token'],
  ] as const)('%s is 401 unauthorized', async (_case, scheme, withToken) => {
    const { url, token } = service();
    const authorization =
      scheme === undefined
        ? undefined
        : withToken === 'token'
          ? `${scheme} ${token}`
          : scheme;

    const answer = await postFile(url, 'hello.txt', 'hello world', {
      token: null,
      authorization,
    });

    expect(answer.status).toBe(401);
    expect(errorOf(answer).code).toBe('unauthorized');
    expect(errorOf(answer).message).not.toBe('');
    expect(answer.text).not.toContain('hello world');
  });

  it('a large upload with a wrong token is 401, not 413, before its body is read', async () => {
    const { address } = service();
    const head = fileHead('large.txt');
    const declared = head.length + 20 * MIB + bodyTail().length;
    const connection = await openConnection(address);
    try {
      await connection.send(
        Buffer.concat([
          requestHead({
            token: 'wrong-token-value',
            contentType: multipartContentType(),
            contentLength: declared,
          }),
          head,
          Buffer.alloc(64 * 1024, 0x78),
        ]),
      );

      const answer = await connection.response(10_000);

      expect(answer?.status).toBe(401);
      expect(answer?.text).toContain('"unauthorized"');
    } finally {
      connection.destroy();
    }
  });
});

describe('paths that answer without a token (Req 1.6)', () => {
  it.each([
    '/healthz',
    '/readyz',
    '/openapi.json',
    '/openapi.json?any=query',
  ])('GET %s is 200 without a token', async (path) => {
    const answer = await getPath(service().url, path);
    const [key, value] = OPEN_BODY[path.split('?')[0] ?? ''] ?? [];

    expect(answer.status).toBe(200);
    expect(key === undefined ? undefined : jsonOf(answer)[key]).toBe(value);
  });

  it.each([
    ['GET', '/nonexistent'],
    ['POST', '/nonexistent'],
    ['GET', '/extract'],
    ['GET', '/healthz/'],
    ['GET', '/HEALTHZ'],
    ['GET', '/readyz/extra'],
    ['GET', '/openapi.json/'],
    ['GET', '/docs'],
    ['GET', '/redoc'],
  ])('%s %s without a token is 401 unauthorized', async (method, path) => {
    const answer = await callPath(service().url, method, path, null);

    expect(answer.status).toBe(401);
    expect(errorOf(answer).code).toBe('unauthorized');
  });

  it('an unknown path with a valid token is 404: the token passed, then nothing matched', async () => {
    const { url, token } = service();

    const answer = await callPath(url, 'GET', '/nonexistent', token);

    expect(answer.status).toBe(404);
  });
});
