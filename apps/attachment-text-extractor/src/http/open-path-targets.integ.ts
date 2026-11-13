import { errorOf, postFile } from './spec-support/extract-client';
import { fakeRunner } from './spec-support/fake-runner';
import { requestHead, sendRaw } from './spec-support/raw-http';
import { useTestService } from './spec-support/test-service';

// Req 1.6 / 1.13: only the three paths, written exactly so, answer without a
// token. A request target the URL parser resolves to one of them, or to
// /extract ("/./healthz", "/%68ealthz", "/healthz/../extract"), still needs it.

let runner = fakeRunner();
const service = useTestService(() => {
  runner = fakeRunner();
  return { runner };
});

const tokenless = async (method: string, target: string) => {
  const answer = await sendRaw(
    service.current().address,
    requestHead({ method, path: target, token: null, contentLength: 0 }),
  );
  return answer?.status;
};

describe('request targets that resolve to an open path', () => {
  it.each([
    '/./healthz',
    '/a/../healthz',
    '/%2e/healthz',
    '/%68ealthz',
    '//healthz',
    '/readyz/.',
    '/%6Fpenapi.json',
    'http://test/healthz',
  ])('GET %s without a token is 401', async (target) => {
    expect(await tokenless('GET', target)).toBe(401);
  });
});

describe('request targets that resolve to /extract', () => {
  it.each([
    '/healthz/../extract',
    '/readyz/../extract',
    '/./extract',
    '/%2e%2e/extract',
    '//extract',
    'http://test/extract',
  ])('POST %s without a token is 401 and never reaches the conversion', async (target) => {
    expect(await tokenless('POST', target)).toBe(401);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('the exact path with the token still converts (the check is not a blanket refusal)', async () => {
    const { url, token } = service.current();

    expect((await postFile(url, 'a.txt', 'x', { token })).status).toBe(200);
  });
});

describe('the open paths as written', () => {
  it.each([
    '/healthz',
    '/readyz',
    '/openapi.json',
    '/openapi.json?any=query',
  ])('GET %s without a token is 200', async (target) => {
    expect(await tokenless('GET', target)).toBe(200);
  });

  it('a tokenless POST /extract is 401 unauthorized', async () => {
    const { url } = service.current();
    const answer = await postFile(url, 'a.txt', 'x', { token: null });

    expect(errorOf(answer).code).toBe('unauthorized');
  });
});
