import { getPath, jsonOf, recordOf } from './spec-support/extract-client';
import { fakeRunner } from './spec-support/fake-runner';
import { useTestService } from './spec-support/test-service';

// /healthz and /readyz on the HTTP layer, with the runner's readiness scripted
// (Req 8.8, D2). Python test_health.py and test_main.py's lifespan rows that
// carry over: ready -> 200, not ready -> 503 `not_ready`, public names only,
// and /readyz is asked afresh every time, so a pod that was not ready comes
// back (Python re-verified a cached "not ready"; research.md 22.3).
// Readiness carries only `ready` (research.md 23.5), so which component is
// missing is not checked (Python's "anydoc: missing" row has no counterpart).

let runner = fakeRunner();
const service = useTestService(() => {
  runner = fakeRunner();
  return { runner };
});

const INTERNAL =
  /child[_-]entry|conversion-runner|src\/|\.ts\b|\.js\b|Error|at \w+ \(/;

describe('GET /healthz', () => {
  it('is 200 {"status":"ok"} without a token', async () => {
    const answer = await getPath(service.current().url, '/healthz');

    expect(answer.status).toBe(200);
    expect(jsonOf(answer)).toEqual({ status: 'ok' });
  });

  it('ignores a wrong Authorization header', async () => {
    const answer = await getPath(service.current().url, '/healthz', 'wrong');

    expect(answer.status).toBe(200);
    expect(jsonOf(answer)).toEqual({ status: 'ok' });
  });

  it('stays 200 while the service is not ready (Req 8.8)', async () => {
    runner.readiness.mockResolvedValue({ ready: false });

    const answer = await getPath(service.current().url, '/healthz');

    expect(answer.status).toBe(200);
    expect(jsonOf(answer)).toEqual({ status: 'ok' });
  });
});

describe('GET /readyz', () => {
  it('is 200 "ready" with the real dependency names (D2), all "ok"', async () => {
    const answer = await getPath(service.current().url, '/readyz');

    expect(answer.status).toBe(200);
    expect(jsonOf(answer)).toEqual({
      status: 'ready',
      dependencies: {
        '@firecrawl/anydoc': 'ok',
        '@embedpdf/pdfium': 'ok',
        prlimit: 'ok',
        converter: 'ok',
      },
    });
  });

  it('is 503 "not_ready" when the runner is not ready', async () => {
    runner.readiness.mockResolvedValue({ ready: false });

    const answer = await getPath(service.current().url, '/readyz');

    expect(answer.status).toBe(503);
    expect(jsonOf(answer).status).toBe('not_ready');
    expect(answer.text).not.toMatch(INTERNAL);
  });

  it('comes back to 200 once the runner is ready again (not cached)', async () => {
    runner.readiness
      .mockResolvedValueOnce({ ready: false })
      .mockResolvedValueOnce({ ready: true });
    const { url } = service.current();

    const first = await getPath(url, '/readyz');
    const second = await getPath(url, '/readyz');

    expect(first.status).toBe(503);
    expect(second.status).toBe(200);
    expect(jsonOf(second).status).toBe('ready');
  });

  it('goes to 503 when a ready runner stops being ready (not cached either way)', async () => {
    runner.readiness
      .mockResolvedValueOnce({ ready: true })
      .mockResolvedValueOnce({ ready: false });
    const { url } = service.current();

    expect((await getPath(url, '/readyz')).status).toBe(200);
    expect((await getPath(url, '/readyz')).status).toBe(503);
  });

  it('stays 503 while the runner stays not ready', async () => {
    runner.readiness.mockResolvedValue({ ready: false });
    const { url } = service.current();

    expect((await getPath(url, '/readyz')).status).toBe(503);
    expect((await getPath(url, '/readyz')).status).toBe(503);
  });

  it('needs no token', async () => {
    const answer = await getPath(service.current().url, '/readyz');

    expect(answer.status).toBe(200);
    expect(jsonOf(answer).status).toBe('ready');
  });

  it('names no internal module and no PDF strategy', async () => {
    const answer = await getPath(service.current().url, '/readyz');

    expect(Object.keys(jsonOf(answer)).sort()).toEqual([
      'dependencies',
      'status',
    ]);
    expect(Object.keys(recordOf(jsonOf(answer).dependencies))).not.toContain(
      'pdf_strategy',
    );
    expect(answer.text).not.toMatch(/pdf_strategy|pdf_extraction_strategy/);
    expect(answer.text).not.toMatch(INTERNAL);
  });
});
