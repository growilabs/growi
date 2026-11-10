import { ERROR_TABLE } from '../../src/http/error-table';
import {
  type Answer,
  getPath,
  jsonOf,
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
import { responseChecker, schemaChecker, textAt } from './openapi-support';

// The document is generated from the route definitions (research.md 17.13).
// Checked here: (1) what a client generated from it keeps for POST /extract
// (Req 7.1, 7.2): the request fields and whether they are required, the
// answer types, the ErrorCode values; (2) real answers fit the documented
// schemas, read in the strict view (17.7 2 (iv)): an undocumented field or
// status fails, and only the authentication 401 may go undocumented.
// Node only (these are not the FastAPI document's shapes), so not in the
// black-box tests. Python test_schemas.py maps here.

let runner = fakeRunner();
const service = useTestService(() => {
  runner = fakeRunner();
  return { runner, env: { MAX_FILE_SIZE_MB: '1' } };
});

const served = async (): Promise<Record<string, unknown>> =>
  jsonOf(await getPath(service.current().url, '/openapi.json'));

const EXTRACT = ['paths', '/extract', 'post'] as const;
const PAGE = { pageNumber: 1, label: '1', content: 'x' };
const EXTRACTED = {
  pages: [PAGE],
  mimeType: 'text/plain',
  extractedCharacters: 1,
};

describe('what a client generated from the document keeps (Req 7.1, 7.2)', () => {
  it('documents POST /extract, GET /healthz and GET /readyz', async () => {
    const doc = await served();

    expect(textAt(doc, EXTRACT)).toBeDefined();
    expect(textAt(doc, ['paths', '/healthz', 'get'])).toBeDefined();
    expect(textAt(doc, ['paths', '/readyz', 'get'])).toBeDefined();
  });

  it('POST /extract takes a multipart body: `file` binary and required, `mimeType` an optional string', async () => {
    const doc = await served();
    const body = recordOf(textAt(doc, [...EXTRACT, 'requestBody']));
    const schema = textAt(body, ['content', 'multipart/form-data', 'schema']);
    const fits = schemaChecker(doc, schema);

    expect(body.required).toBe(true);
    expect(Object.keys(recordOf(body.content))).toEqual([
      'multipart/form-data',
    ]);
    expect(textAt(schema, ['properties', 'file', 'format'])).toBe('binary');
    expect(fits({ file: 'x' })).toEqual([]);
    expect(fits({ file: 'x', mimeType: 'text/plain' })).toEqual([]);
    expect(fits({ mimeType: 'text/plain' })).not.toEqual([]);
    expect(fits({ file: 'x', mimeType: 1 })).not.toEqual([]);
    expect(fits({ file: 'x', mime_type: 'text/plain' })).not.toEqual([]);
  });

  it('names the schemas the client and apps/app use', async () => {
    const schemas = recordOf(textAt(await served(), ['components', 'schemas']));

    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'ErrorCode',
        'ErrorResponse',
        'ExtractResponse',
        'PageInfo',
      ]),
    );
  });

  it('ErrorCode has the eight values', async () => {
    expect(
      textAt(await served(), ['components', 'schemas', 'ErrorCode', 'enum']),
    ).toEqual([
      'unauthorized',
      'unsupported_format',
      'file_too_large',
      'extraction_timeout',
      'service_busy',
      'extraction_failed',
      'file_encrypted',
      'resource_limit_exceeded',
    ]);
  });

  it('the 200 of POST /extract is an ExtractResponse of PageInfo items', async () => {
    const doc = await served();
    const ok = (body: unknown) =>
      responseChecker(doc)('/extract', 'post', 200, body);

    expect(ok(EXTRACTED)).toEqual([]);
    expect(
      ok({
        ...EXTRACTED,
        pages: [{ pageNumber: null, label: null, content: '' }],
      }),
    ).toEqual([]);
    expect(
      ok({ ...EXTRACTED, pages: [{ ...PAGE, pageNumber: '1' }] }),
    ).not.toEqual([]);
    expect(
      ok({ ...EXTRACTED, pages: [{ ...PAGE, pageNumber: 1.5 }] }),
    ).not.toEqual([]);
    expect(
      ok({ ...EXTRACTED, pages: [{ pageNumber: 1, label: '1' }] }),
    ).not.toEqual([]);
    expect(ok({ ...EXTRACTED, extractedCharacters: 1.5 })).not.toEqual([]);
    expect(ok({ pages: [], mimeType: 'text/plain' })).not.toEqual([]);
    expect(ok({ ...EXTRACTED, engine: 'x' })).not.toEqual([]);
  });

  it('every error answer of POST /extract is an ErrorResponse, under the statuses the FastAPI document had', async () => {
    const doc = await served();
    const statuses = Object.keys(
      recordOf(textAt(doc, [...EXTRACT, 'responses'])),
    ).filter((status) => status !== '200');
    const check = responseChecker(doc);

    expect(statuses.sort()).toEqual(['400', '408', '413', '422', '500', '503']);
    for (const status of statuses.map(Number)) {
      const error = (body: unknown) => check('/extract', 'post', status, body);
      expect(
        error({ code: 'file_too_large', message: 'x' }),
        `${status}`,
      ).toEqual([]);
      expect(
        error({ code: 'no_such_code', message: 'x' }),
        `${status}`,
      ).not.toEqual([]);
      expect(error({ code: 'file_too_large' }), `${status}`).not.toEqual([]);
    }
  });

  it('the check lets only the authentication 401 go undocumented', async () => {
    const check = responseChecker(await served());

    expect(
      check('/extract', 'post', 401, { code: 'unauthorized', message: 'x' }),
    ).toEqual([]);
    expect(
      check('/extract', 'post', 418, {
        code: 'extraction_failed',
        message: 'x',
      }),
    ).not.toEqual([]);
    expect(check('/healthz', 'get', 503, {})).not.toEqual([]);
  });
});

describe('(iv) real answers fit the documented schemas', () => {
  const fits = async (path: string, method: string, answer: Answer) => {
    const check = responseChecker(await served());
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
    await fits('/extract', 'post', answer);
  });

  it.each(Object.keys(ERROR_TABLE))('the %s failure', async (kind) => {
    const failure = Object.keys(ERROR_TABLE).find(
      (k): k is keyof typeof ERROR_TABLE => k === kind,
    );
    if (failure === undefined) throw new Error(kind);
    runner.run.mockResolvedValue(failed(failure));

    await fits('/extract', 'post', await post());
  });

  it('413, 422 and 401 from the HTTP layer', async () => {
    const { url, token } = service.current();

    await fits(
      '/extract',
      'post',
      await post(Buffer.alloc(1024 * 1024 + 1, 0x78)),
    );
    await fits(
      '/extract',
      'post',
      await postBody(url, '{}', 'application/json', { token }),
    );
    await fits(
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
    await fits('/extract', 'post', busy);
    held.release();
    await first;
  });

  it('GET /healthz, and GET /readyz ready and not ready', async () => {
    const { url } = service.current();
    runner.readiness
      .mockResolvedValueOnce({ ready: true })
      .mockResolvedValueOnce({ ready: false });

    await fits('/healthz', 'get', await getPath(url, '/healthz'));
    await fits('/readyz', 'get', await getPath(url, '/readyz'));
    const notReady = await getPath(url, '/readyz');
    expect(notReady.status).toBe(503);
    await fits('/readyz', 'get', notReady);
  });
});
