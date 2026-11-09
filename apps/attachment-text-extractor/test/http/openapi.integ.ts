import {
  type Answer,
  getPath,
  jsonOf,
  postBody,
  postFile,
} from '../../src/http/spec-support/extract-client';
import {
  DESCRIPTION_FIXES,
  readCommittedOpenApi,
  responseChecker,
  textAt,
  withoutDescriptions,
} from '../openapi/openapi-support';
import { useBlackboxService } from './blackbox-service';
import { itNodeOnly } from './blackbox-target';

// Black box (research.md 22.7 `openapi`): Req 7.1 / 7.3 from outside. The
// served document equals the committed client document except for the
// `description`s (17.7 1); the 7.1 description fixes are Node only (17.6);
// real answers fit the documented schemas (17.7 2 (iv)). Python
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

  it('documents POST /extract and the ExtractResponse schema', async () => {
    const doc = await served();

    expect(textAt(doc, ['paths', '/extract', 'post', 'operationId'])).toBe(
      'post_extract_extract_post',
    );
    expect(
      textAt(doc, ['components', 'schemas', 'ExtractResponse', 'title']),
    ).toBe('ExtractResponse');
  });

  it('documents the multipart form with `file` required', async () => {
    const doc = await served();

    expect(
      textAt(doc, [
        'paths',
        '/extract',
        'post',
        'requestBody',
        'content',
        'multipart/form-data',
        'schema',
        '$ref',
      ]),
    ).toBe('#/components/schemas/Body_post_extract_extract_post');
    expect(
      textAt(doc, [
        'components',
        'schemas',
        'Body_post_extract_extract_post',
        'required',
      ]),
    ).toEqual(['file']);
  });

  it('equals the committed client document apart from descriptions (drift, Req 7.3)', async () => {
    expect(withoutDescriptions(await served())).toStrictEqual(
      withoutDescriptions(readCommittedOpenApi()),
    );
  });

  itNodeOnly(
    '17.6',
    'carries the five rewritten descriptions (Req 7.1)',
    async () => {
      const doc = await served();

      for (const { pointer, after } of DESCRIPTION_FIXES) {
        expect(textAt(doc, pointer), pointer.join(' > ')).toBe(after);
      }
    },
  );
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

  it('the checker itself rejects an undocumented field and an undocumented status', async () => {
    const check = responseChecker(await served());
    const page = { pageNumber: 1, label: '1', content: 'x' };

    expect(
      check('/extract', 'post', 200, {
        pages: [page],
        mimeType: 'text/plain',
        extractedCharacters: 1,
      }),
    ).toEqual([]);
    expect(
      check('/extract', 'post', 200, {
        pages: [page],
        mimeType: 'text/plain',
        extractedCharacters: 1,
        engine: 'x',
      }),
    ).not.toEqual([]);
    expect(
      check('/extract', 'post', 200, {
        pages: [{ ...page, pageNumber: '1' }],
        mimeType: 'text/plain',
        extractedCharacters: 1,
      }),
    ).not.toEqual([]);
    expect(
      check('/extract', 'post', 418, {
        code: 'extraction_failed',
        message: 'x',
      }),
    ).not.toEqual([]);
    expect(check('/healthz', 'get', 503, {})).not.toEqual([]);
    expect(check('/readyz', 'get', 503, { status: 'not_ready' })).toEqual([]);
  });
});
