import { EXTRACT_RESULTS } from './error-table';
import {
  callPath,
  getPath,
  jsonOf,
  postFile,
  recordOf,
} from './spec-support/extract-client';
import { failed, fakeRunner, holdingRunner } from './spec-support/fake-runner';
import {
  multipartBody,
  multipartContentType,
  uploadParts,
} from './spec-support/multipart';
import {
  type Exposition,
  parseExposition,
  seriesLabels,
  seriesValue,
} from './spec-support/prometheus-text';
import { useTestService } from './spec-support/test-service';

// GET /metrics answers without a token in the Prometheus text format: the
// slots, every answer Hono produced by endpoint and status, each POST /extract
// result with its duration, and the HTTP process's own figures. It writes no
// log line and starts no child, and no label carries what a request sent.

let runner = fakeRunner();
const service = useTestService(() => {
  runner = fakeRunner();
  return { runner };
});

const RESPONSES = 'attachment_extractor_http_responses_total';
const RESULTS = 'attachment_extractor_extract_results_total';
const DURATION = 'attachment_extractor_extract_duration_seconds';
const IN_USE = 'attachment_extractor_slots_in_use';
const MAX = 'attachment_extractor_slots_max';
const APP_ID_MARKER = 'app-id-marker-5d1e';

const scrape = async (url = service.current().url): Promise<Exposition> => {
  const answer = await getPath(url, '/metrics');
  expect(answer.status).toBe(200);
  return parseExposition(answer.text);
};

const post = (data = 'x') => {
  const { url, token } = service.current();
  return postFile(url, 'a.txt', data, { token });
};

describe('GET /metrics', () => {
  it('answers 200 without a token, in the Prometheus text format', async () => {
    const answer = await getPath(service.current().url, '/metrics');

    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toMatch(
      /^text\/plain; version=0\.0\.4/,
    );
    expect(answer.text).toContain(`# TYPE ${RESPONSES} counter`);
  });

  it('declares every service metric with its type', async () => {
    const { types } = await scrape();

    expect(types.get(IN_USE)).toBe('gauge');
    expect(types.get(MAX)).toBe('gauge');
    expect(types.get(RESPONSES)).toBe('counter');
    expect(types.get(RESULTS)).toBe('counter');
    expect(types.get(DURATION)).toBe('histogram');
  });

  it("carries the HTTP process's CPU time, memory and event loop lag", async () => {
    const { types } = await scrape();

    expect(types.get('process_cpu_seconds_total')).toBe('counter');
    expect(types.get('process_resident_memory_bytes')).toBe('gauge');
    expect(types.get('nodejs_eventloop_lag_seconds')).toBe('gauge');
  });

  it('writes no log line and starts no conversion or readiness check', async () => {
    const before = service.current().logs.length;

    await scrape();
    await scrape();

    expect(service.current().logs.length).toBe(before);
    expect(runner.run).not.toHaveBeenCalled();
    expect(runner.readiness).not.toHaveBeenCalled();
  });

  it('is not in the OpenAPI document', async () => {
    const document = jsonOf(
      await getPath(service.current().url, '/openapi.json'),
    );

    expect(Object.keys(recordOf(document.paths))).not.toContain('/metrics');
  });
});

describe('the response counter', () => {
  it('counts each answer by endpoint and status, 401 and 404 included', async () => {
    const { url, token } = service.current();
    runner.run.mockResolvedValueOnce(failed('malformed'));

    expect((await post()).status).toBe(422);
    expect((await post()).status).toBe(200);
    expect((await postFile(url, 'a.txt', 'x', { token: null })).status).toBe(
      401,
    );
    expect((await callPath(url, 'GET', '/extract', token)).status).toBe(404);
    expect((await callPath(url, 'GET', '/unknown', token)).status).toBe(404);
    expect((await callPath(url, 'GET', '/unknown', null)).status).toBe(401);
    expect((await callPath(url, 'GET', '/healthz', null)).status).toBe(200);
    const metrics = await scrape();

    expect(
      seriesLabels(metrics, RESPONSES).map(
        ({ endpoint, status }) => `${endpoint} ${status}`,
      ),
    ).toEqual(
      expect.arrayContaining([
        '/extract 422',
        '/extract 200',
        '/extract 401',
        '/extract 404',
        'other 404',
        'other 401',
        '/healthz 200',
      ]),
    );
    const count = (endpoint: string, status: string) =>
      seriesValue(metrics, RESPONSES, { endpoint, status });
    expect(count('/extract', '422')).toBe(1);
    expect(count('/extract', '200')).toBe(1);
    expect(count('/extract', '401')).toBe(1);
    expect(count('/extract', '404')).toBe(1);
    expect(count('other', '404')).toBe(1);
    expect(count('other', '401')).toBe(1);
    expect(count('/healthz', '200')).toBe(1);
  });

  it('labels a target that only resolves to a path as other', async () => {
    const { url } = service.current();
    await callPath(url, 'GET', '/%68ealthz', null);

    expect(
      seriesValue(await scrape(), RESPONSES, {
        endpoint: 'other',
        status: '401',
      }),
    ).toBe(1);
  });

  it('counts GET /metrics itself', async () => {
    await scrape();

    expect(
      seriesValue(await scrape(), RESPONSES, {
        endpoint: '/metrics',
        status: '200',
      }),
    ).toBe(1);
  });

  it('has no other labels than endpoint and status', async () => {
    await post();

    const metrics = await scrape();
    for (const labels of seriesLabels(metrics, RESPONSES)) {
      expect(Object.keys(labels).sort()).toEqual(['endpoint', 'status']);
    }
  });
});

describe('the slot gauges', () => {
  it('slots_max is MAX_CONCURRENCY', async () => {
    const { url } = await service.restart(fakeRunner(), {
      MAX_CONCURRENCY: '3',
    });

    expect(seriesValue(await scrape(url), MAX)).toBe(3);
  });

  it('slots_in_use counts the slot a conversion holds, and drops when it ends', async () => {
    const held = holdingRunner();
    const { url, token } = await service.restart(held.runner);
    expect(seriesValue(await scrape(url), IN_USE)).toBe(0);

    const answer = postFile(url, 'a.txt', 'x', { token });
    await held.started;
    expect(seriesValue(await scrape(url), IN_USE)).toBe(1);

    held.release();
    expect((await answer).status).toBe(200);
    expect(seriesValue(await scrape(url), IN_USE)).toBe(0);
  });
});

describe('the extract results', () => {
  it('starts every result at zero, the ones not seen yet included', async () => {
    const metrics = await scrape();

    for (const result of EXTRACT_RESULTS) {
      expect(seriesValue(metrics, RESULTS, { result })).toBe(0);
      expect(seriesValue(metrics, `${DURATION}_count`, { result })).toBe(0);
    }
  });

  it('counts each result and observes its duration', async () => {
    runner.run.mockResolvedValueOnce(failed('memory_exceeded'));
    await post();
    await post();
    await post();
    const metrics = await scrape();

    expect(seriesValue(metrics, RESULTS, { result: 'ok' })).toBe(2);
    expect(seriesValue(metrics, RESULTS, { result: 'memory_exceeded' })).toBe(
      1,
    );
    expect(seriesValue(metrics, RESULTS, { result: 'malformed' })).toBe(0);
    expect(seriesValue(metrics, `${DURATION}_count`, { result: 'ok' })).toBe(2);
    expect(
      seriesValue(metrics, `${DURATION}_bucket`, { result: 'ok', le: '+Inf' }),
    ).toBe(2);
    expect(
      seriesValue(metrics, `${DURATION}_bucket`, { result: 'ok', le: '80' }),
    ).toBe(2);
  });

  it('uses the documented histogram bounds', async () => {
    const bounds = seriesLabels(await scrape(), `${DURATION}_bucket`)
      .filter(({ result }) => result === 'ok')
      .map(({ le }) => le);

    expect(bounds).toEqual([
      '0.05',
      '0.1',
      '0.25',
      '0.5',
      '1',
      '2.5',
      '5',
      '10',
      '20',
      '40',
      '60',
      '80',
      '+Inf',
    ]);
  });

  it('counts a refusal given before the body is read', async () => {
    const { url, token } = await service.restart(fakeRunner(), {
      MAX_CONCURRENCY: '0',
    });
    expect((await postFile(url, 'a.txt', 'x', { token })).status).toBe(503);

    expect(
      seriesValue(await scrape(url), RESULTS, { result: 'service_busy' }),
    ).toBe(1);
  });

  it('counts the 422 made after the caller went away, and the disconnect', async () => {
    const held = holdingRunner({ endOnAbort: true });
    const { url, token } = await service.restart(held.runner);
    const caller = new AbortController();
    const leaving = postFile(url, 'a.txt', 'slow', {
      token,
      signal: caller.signal,
    }).catch(() => null);
    await held.started;

    caller.abort();
    await leaving;

    // The answer is counted once it is built, after the run has ended.
    await expect
      .poll(async () =>
        seriesValue(await scrape(url), RESPONSES, {
          endpoint: '/extract',
          status: '422',
        }),
      )
      .toBe(1);
    expect(
      seriesValue(await scrape(url), RESULTS, {
        result: 'client_disconnected',
      }),
    ).toBe(1);
  });

  it('counts a runner that raised as internal, once', async () => {
    runner.run.mockRejectedValueOnce(new Error('boom'));
    expect((await post()).status).toBe(500);

    const metrics = await scrape();
    expect(seriesValue(metrics, RESULTS, { result: 'internal' })).toBe(1);
    expect(
      seriesValue(metrics, `${DURATION}_count`, { result: 'internal' }),
    ).toBe(1);
  });

  it.each([
    'ERROR',
    'CRITICAL',
  ])('counts results with LOG_LEVEL=%s, which writes no request line', async (level) => {
    const quiet = fakeRunner();
    const current = await service.restart(quiet, { LOG_LEVEL: level });
    await postFile(current.url, 'a.txt', 'x', { token: current.token });

    expect(
      current.logs.filter((line) => line.includes('extract format=')),
    ).toEqual([]);
    expect(
      seriesValue(await scrape(current.url), RESULTS, { result: 'ok' }),
    ).toBe(1);
  });
});

describe('labels', () => {
  it('never carry the X-Growi-App-Id value', async () => {
    const { url, token } = service.current();
    const answer = await fetch(`${url}/extract`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': multipartContentType(),
        'x-growi-app-id': APP_ID_MARKER,
      },
      body: new Uint8Array(multipartBody(uploadParts('a.txt', 'x'))),
    });
    expect(answer.status).toBe(200);
    expect(
      service.current().logs.some((line) => line.endsWith(APP_ID_MARKER)),
    ).toBe(true);

    const metrics = await getPath(url, '/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).not.toContain(APP_ID_MARKER);
  });
});
