import { loadSettings } from '../../src/config/load-settings';
import { ERROR_CODES } from '../../src/contract/error-code';
import { createApp } from '../../src/http';
import { ERROR_TABLE } from '../../src/http/error-table';
import { openApiDocument } from '../../src/http/openapi-route';
import {
  type Answer,
  getPath,
  postBody,
  postFile,
  recordOf,
} from '../../src/http/spec-support/extract-client';
import {
  failed,
  fakeRunner,
  holdingRunner,
  succeeded,
} from '../../src/http/spec-support/fake-runner';
import { useTestService } from '../../src/http/spec-support/test-service';
import { responseChecker, textAt } from './openapi-support';

// The document is kept by hand (research.md 17.1), so the code must be checked
// against it (17.7 2): (i) the routes, (ii) the ErrorCode values, (iii) the
// error table's statuses, (iv) the shape of real answers, checked with ajv
// against the documented schemas (an undocumented field or status fails;
// only the auth 401 and /readyz's 503 may go undocumented).
// Python test_schemas.py (ErrorCode order, response shapes) maps here.

const check = responseChecker(openApiDocument);

describe('the code against the document', () => {
  it('(i) serves exactly the documented operations plus GET /openapi.json', () => {
    const app = createApp({
      settings: loadSettings({
        ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: 'routes-only',
      }),
      runner: fakeRunner(),
      writeLog: () => {},
    });
    const served = app.routes
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);
    const documented = Object.entries(
      recordOf(textAt(openApiDocument, ['paths'])),
    ).flatMap(([path, operations]) =>
      Object.keys(recordOf(operations)).map(
        (method) => `${method.toUpperCase()} ${path}`,
      ),
    );

    expect(new Set(served)).toEqual(
      new Set([...documented, 'GET /openapi.json']),
    );
  });

  it('(ii) ERROR_CODES are the documented enum, in order', () => {
    expect(ERROR_CODES).toEqual(
      textAt(openApiDocument, ['components', 'schemas', 'ErrorCode', 'enum']),
    );
  });

  it('(iii) every status of the error table is documented for POST /extract', () => {
    const documented = Object.keys(
      recordOf(
        textAt(openApiDocument, ['paths', '/extract', 'post', 'responses']),
      ),
    );

    for (const { status } of Object.values(ERROR_TABLE)) {
      expect(documented).toContain(String(status));
    }
  });
});

describe('(iv) real answers fit the documented schemas', () => {
  let runner = fakeRunner();
  const service = useTestService(() => {
    runner = fakeRunner();
    return { runner, env: { MAX_FILE_SIZE_MB: '1' } };
  });

  const fits = (path: string, method: string, answer: Answer): void => {
    expect(check(path, method, answer.status, JSON.parse(answer.text))).toEqual(
      [],
    );
  };

  const post = (data: string | Uint8Array = 'x') => {
    const { url, token } = service.current();
    return postFile(url, 'a.txt', data, { token });
  };

  it('200 with null positions, a surrogate pair and an empty page', async () => {
    runner.run.mockResolvedValue(
      succeeded([
        { pageNumber: null, label: null, content: 'こんにちは😀' },
        { pageNumber: 2, label: 'Sheet', content: '' },
      ]),
    );

    const answer = await post();

    expect(answer.status).toBe(200);
    fits('/extract', 'post', answer);
  });

  it.each(Object.keys(ERROR_TABLE))('the %s failure', async (kind) => {
    const failure = Object.keys(ERROR_TABLE).find(
      (k): k is keyof typeof ERROR_TABLE => k === kind,
    );
    if (failure === undefined) throw new Error(kind);
    runner.run.mockResolvedValue(failed(failure));

    fits('/extract', 'post', await post());
  });

  it('413, 422 and 401 from the HTTP layer', async () => {
    const { url } = service.current();

    fits('/extract', 'post', await post(Buffer.alloc(1024 * 1024 + 1, 0x78)));
    fits(
      '/extract',
      'post',
      await postBody(url, '{}', 'application/json', {
        token: service.current().token,
      }),
    );
    fits(
      '/extract',
      'post',
      await postFile(url, 'a.txt', 'x', { token: null }),
    );
  });

  it('503 while every slot is busy', async () => {
    const held = holdingRunner();
    const { url, token } = await service.restart(held.runner, {
      MAX_CONCURRENCY: '1',
    });
    const first = postFile(url, 'a.txt', 'slow', { token });
    await held.started;

    const busy = await postFile(url, 'a.txt', 'probe', { token });

    expect(busy.status).toBe(503);
    fits('/extract', 'post', busy);
    held.release();
    await first;
  });

  it('GET /healthz, and GET /readyz ready and not ready', async () => {
    const { url } = service.current();
    runner.readiness
      .mockResolvedValueOnce({ ready: true })
      .mockResolvedValueOnce({ ready: false });

    fits('/healthz', 'get', await getPath(url, '/healthz'));
    fits('/readyz', 'get', await getPath(url, '/readyz'));
    const notReady = await getPath(url, '/readyz');
    expect(notReady.status).toBe(503);
    fits('/readyz', 'get', notReady);
  });
});
