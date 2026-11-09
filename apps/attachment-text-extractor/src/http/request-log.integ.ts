import { setTimeout as sleep } from 'node:timers/promises';

import { postBody, postFile } from './spec-support/extract-client';
import {
  failed,
  fakeRunner,
  holdingRunner,
  succeeded,
} from './spec-support/fake-runner';
import { useTestService } from './spec-support/test-service';

// Req 1.7: one line per POST /extract with the format, size, duration, result
// and the child's peak RSS, and never the file name, the content or the token
// (also Req 1.8 on the log side). The line keeps the target spec's form:
// "extract format=… size=… duration_ms=… result=… child_peak_rss_mb=…".
// Python test_extract_router.py TestLogging, test_live_server.py
// TestProductionLogging, and the log side of test_e2e_http.py TestHygieneOverHttp.

let runner = fakeRunner();
const service = useTestService(() => {
  runner = fakeRunner();
  return { runner };
});

const CONTENT_MARKER = 'SECRET-CONTENT-MARKER-7f3a';
const FILE_NAME_MARKER = 'SECRET-FILE-NAME-MARKER-91c2';
const LINE =
  /extract format=(\S+) size=(\d+) duration_ms=(\d+) result=(\S+) child_peak_rss_mb=(\d+|unknown)$/;

interface RequestLine {
  readonly format: string;
  readonly size: number;
  readonly result: string;
  readonly rss: string;
}

const requestLines = (): RequestLine[] =>
  service
    .current()
    .logs.filter((line) => line.includes('extract format='))
    .map((line) => {
      const match = LINE.exec(line);
      if (match === null) throw new Error(`not a request line: ${line}`);
      const [, format = '', size = '', , result = '', rss = ''] = match;
      return { format, size: Number(size), result, rss };
    });

/** The request lines once at least `count` are written (a line may follow its answer). */
const linesAfter = async (count: number): Promise<RequestLine[]> => {
  await expect
    .poll(() => requestLines().length, { timeout: 2_000 })
    .toBeGreaterThanOrEqual(count);
  return requestLines();
};

const post = (
  fileName: string,
  data: string | Uint8Array,
  token?: string | null,
) => {
  const current = service.current();
  return postFile(current.url, fileName, data, {
    token: token === undefined ? current.token : token,
  });
};

describe('the request line', () => {
  it('is one line per request with every field, and nothing from the upload', async () => {
    runner.run.mockResolvedValue(
      succeeded([{ pageNumber: 1, label: '1', content: CONTENT_MARKER }]),
    );

    await post(`${FILE_NAME_MARKER}.txt`, CONTENT_MARKER);

    expect(await linesAfter(1)).toEqual([
      {
        format: 'text/plain',
        size: CONTENT_MARKER.length,
        result: 'ok',
        rss: '42',
      },
    ]);
    const everything = service.current().logs.join('\n');
    expect(everything).not.toContain(CONTENT_MARKER);
    expect(everything).not.toContain(FILE_NAME_MARKER);
    expect(everything).not.toContain(service.current().token);
  });

  it('names the failure kind and the child RSS, never the detail', async () => {
    runner.run.mockResolvedValue(failed('memory_exceeded', 7));

    await post('a.txt', 'x');

    expect(await linesAfter(1)).toEqual([
      { format: 'txt', size: 1, result: 'memory_exceeded', rss: '7' },
    ]);
    expect(service.current().logs.join('\n')).not.toContain('internal detail');
  });

  it('writes "unknown" when no child RSS was measured', async () => {
    runner.run.mockResolvedValue(failed('limit_exceeded', null));

    await post('a.csv', 'x');

    expect(await linesAfter(1)).toEqual([
      { format: 'csv', size: 1, result: 'limit_exceeded', rss: 'unknown' },
    ]);
  });

  it.each([
    ['Report.PDF', 'pdf'],
    [`${FILE_NAME_MARKER}.T_x-T`, 'txt'],
    ['archive.abcdefghijklmnop', 'abcdefghij'],
    [FILE_NAME_MARKER, 'unknown'],
    ['a.日本', 'unknown'],
  ])('logs %s with format=%s: the extension only, cleaned', async (fileName, format) => {
    runner.run.mockResolvedValue(failed('unsupported'));

    await post(fileName, 'x');

    expect((await linesAfter(1)).map((line) => line.format)).toEqual([format]);
    expect(service.current().logs.join('\n')).not.toContain(FILE_NAME_MARKER);
  });

  it('logs three successes and one failure as four lines', async () => {
    runner.run
      .mockResolvedValueOnce(succeeded())
      .mockResolvedValueOnce(succeeded())
      .mockResolvedValueOnce(succeeded())
      .mockResolvedValueOnce(failed('unsupported'));

    for (const name of ['a.txt', 'b.txt', 'c.txt', 'x.unknownext']) {
      await post(name, 'x');
    }

    expect((await linesAfter(4)).map((line) => line.result)).toEqual([
      'ok',
      'ok',
      'ok',
      'unsupported',
    ]);
  });

  it('logs the answers the HTTP layer gives itself', async () => {
    const held = holdingRunner();
    const { url, token } = await service.restart(held.runner, {
      MAX_CONCURRENCY: '1',
      MAX_FILE_SIZE_MB: '1',
    });
    const first = postFile(url, 'a.txt', 'slow', { token });
    await held.started;
    await postFile(url, 'a.txt', 'probe', { token });
    held.release();
    await first;
    await postFile(url, 'a.txt', Buffer.alloc(1024 * 1024 + 1, 0x78), {
      token,
    });
    await postBody(url, '{}', 'application/json', { token });

    expect((await linesAfter(4)).map((line) => line.result)).toEqual([
      'service_busy',
      'ok',
      'file_too_large',
      'invalid_upload',
    ]);
  });

  it('keeps a token sent by a caller out of the log', async () => {
    await post('a.txt', 'x');
    await postFile(service.current().url, 'a.txt', 'x', {
      token: null,
      authorization: 'Bearer leaked-token-value',
    });

    expect(await linesAfter(1)).not.toHaveLength(0);
    const everything = service.current().logs.join('\n');
    expect(everything).not.toContain('leaked-token-value');
    expect(everything).not.toContain(service.current().token);
  });
});

describe('LOG_LEVEL (Req 1.4)', () => {
  it.each([
    'INFO',
    'DEBUG',
    'NOTSET',
  ])('%s writes the request line', async (level) => {
    const { url, token } = await service.restart(runner, { LOG_LEVEL: level });

    await postFile(url, 'a.txt', 'x', { token });

    expect(await linesAfter(1)).toHaveLength(1);
  });

  it.each([
    'WARNING',
    'ERROR',
    'CRITICAL',
  ])('%s leaves it out', async (level) => {
    const { url, token } = await service.restart(runner, { LOG_LEVEL: level });

    expect((await postFile(url, 'a.txt', 'x', { token })).status).toBe(200);
    // Absence cannot be awaited: give a line that would follow its answer the
    // time the other tests wait for one at most.
    await sleep(200);

    expect(requestLines()).toHaveLength(0);
  });
});
