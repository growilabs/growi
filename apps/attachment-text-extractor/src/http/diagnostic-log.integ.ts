import { buildDocx } from '../../test/fixtures';
import type { ConversionRunnerOptions } from '../runner/conversion-runner';
import { killStrayChildren, STAND_IN_CHILD } from '../runner/spec-support';
import { callPath, getPath, postFile } from './spec-support/extract-client';
import {
  realRunner,
  startTestService,
  type TestService,
} from './spec-support/test-service';

// research.md 7.8, seen from outside: the service's whole log (the request
// lines and the runner's diagnostic lines in one sink) for requests anyone can
// send. /readyz needs no token, so asking it again must not add lines; no line
// carries anything of an upload (Req 1.7, 1.8); a request other than /extract
// still leaves no line.

const CONTENT_MARKER = 'SECRET-CONTENT-MARKER-7f3a';
const FILE_NAME_MARKER = 'SECRET-FILE-NAME-MARKER-91c2';
const NO_PRLIMIT = { prlimitPath: '/nonexistent/prlimit' };
const LINE =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z ((?:INFO|WARNING|ERROR) [ -~]+)$/;
const REQUEST_LINE =
  /^INFO extract format=\S+ size=\d+ duration_ms=\d+ result=(\S+) child_peak_rss_mb=(?:\d+|unknown)$/;

let service: TestService | undefined;

const start = async (
  overrides: Partial<ConversionRunnerOptions> = {},
  env: Readonly<Record<string, string>> = {},
): Promise<TestService> => {
  const logs: string[] = [];
  service = await startTestService(realRunner(env, overrides, logs), env, logs);
  return service;
};

/** Each line without its time stamp; fails on a line of any other shape. */
const bodies = (logs: readonly string[]): string[] =>
  logs.map((line) => {
    const body = LINE.exec(line)?.[1];
    if (body === undefined) {
      throw new Error(`not a log line: ${JSON.stringify(line)}`);
    }
    return body;
  });

/** The request lines as their result, every other line as it is. */
const summary = (logs: readonly string[]): string[] =>
  bodies(logs).map((body) => {
    const result = REQUEST_LINE.exec(body)?.[1];
    return result === undefined ? body : `extract result=${result}`;
  });

const expectNothingOfTheUpload = ({ logs, token }: TestService): void => {
  const everything = logs.join('\n');
  expect(everything).not.toContain(CONTENT_MARKER);
  expect(everything).not.toContain(FILE_NAME_MARKER);
  expect(everything).not.toContain(token);
  expect(everything).not.toContain('nonexistent');
};

describe.skipIf(process.platform !== 'linux')(
  'the service log beyond the request line',
  { timeout: 60_000 },
  () => {
    afterEach(async () => {
      await service?.close();
      service = undefined;
      await killStrayChildren();
    });

    it('says once why /readyz is 503, however often it is asked without a token', async () => {
      const current = await start(NO_PRLIMIT);

      const first = await getPath(current.url, '/readyz');
      const linesAfterFirst = current.logs.length;
      const more = await Promise.all(
        Array.from({ length: 10 }, () => getPath(current.url, '/readyz')),
      );
      for (let asked = 0; asked < 10; asked += 1) {
        // biome-ignore lint/performance/noAwaitInLoops: separate calls, one after the other
        more.push(await getPath(current.url, '/readyz'));
      }

      expect([first, ...more].map((answer) => answer.status)).toEqual(
        Array.from({ length: 21 }, () => 503),
      );
      // The answer still names nothing (research.md 27.6).
      expect(first.text).toBe('{"status":"not_ready"}');
      expect(linesAfterFirst).toBe(1);
      expect(bodies(current.logs)).toEqual([
        'WARNING readiness probe failed: probe=pdf cause=not_started launcher=prlimit error=ENOENT',
      ]);
    });

    it('says why a conversion crashed, next to its request line, with nothing of the upload', async () => {
      const current = await start(NO_PRLIMIT);

      const answer = await postFile(
        current.url,
        `${FILE_NAME_MARKER}.docx`,
        CONTENT_MARKER,
        { token: current.token, mimeType: `text/${CONTENT_MARKER}` },
      );

      expect(answer.status).toBe(500);
      expect(summary(current.logs)).toEqual([
        'WARNING conversion child could not be started: launcher=prlimit error=ENOENT',
        'extract result=crashed',
      ]);
      expectNothingOfTheUpload(current);
    });

    it('passes a child warning through as its own sentence, and nothing a hostile child writes', async () => {
      const current = await start({ childEntry: STAND_IN_CHILD });
      const hostile = `oom_score_not_raised\n\x1b[31m${CONTENT_MARKER}\n2026-11-11T00:00:00.000Z INFO extract format=pdf size=1 duration_ms=1 result=ok child_peak_rss_mb=1\n`;

      const answer = await postFile(
        current.url,
        `${FILE_NAME_MARKER}.bin`,
        `stderr-echo 20000x${encodeURIComponent(hostile)} -\n${CONTENT_MARKER}`,
        { token: current.token },
      );

      expect(answer.status).toBe(200);
      expect(summary(current.logs)).toEqual([
        'WARNING conversion child warning: could not raise its oom_score_adj',
        'WARNING conversion child warning: wrote unrecognised output to its standard error',
        'extract result=ok',
      ]);
      expectNothingOfTheUpload(current);
    });

    it('adds no line for files the real child refuses or converts', async () => {
      const current = await start();
      const post = (fileName: string, data: Uint8Array | string) =>
        postFile(current.url, fileName, data, { token: current.token });

      const statuses = [
        await post(`${FILE_NAME_MARKER}.docx`, `PK\x03\x04${CONTENT_MARKER}`),
        await post(`${FILE_NAME_MARKER}.pdf`, `%PDF-1.4\n${CONTENT_MARKER}`),
        await post(`${FILE_NAME_MARKER}.msg`, CONTENT_MARKER),
        await post(`${FILE_NAME_MARKER}.txt`, CONTENT_MARKER),
        await post(`${FILE_NAME_MARKER}.docx`, buildDocx([CONTENT_MARKER])),
      ].map((answer) => answer.status);

      expect(statuses).toEqual([422, 422, 400, 200, 200]);
      expect(summary(current.logs)).toEqual([
        'extract result=malformed',
        'extract result=malformed',
        'extract result=unsupported',
        'extract result=ok',
        'extract result=ok',
      ]);
      expectNothingOfTheUpload(current);
    });

    it('still writes no line for a request other than /extract', async () => {
      const current = await start();

      const statuses = [
        await postFile(current.url, 'a.txt', 'x', { token: null }),
        await postFile(current.url, 'a.txt', 'x', {
          token: null,
          authorization: 'Bearer wrong-token-value',
        }),
        await getPath(current.url, '/no-such-path', current.token),
        await callPath(current.url, 'GET', '/extract', current.token),
        await getPath(current.url, '/healthz'),
        await getPath(current.url, '/readyz'),
        await getPath(current.url, '/openapi.json', current.token),
      ].map((answer) => answer.status);

      expect(statuses).toEqual([401, 401, 404, 404, 200, 200, 200]);
      expect(current.logs).toEqual([]);
    });

    it('honours LOG_LEVEL as the request line does', async () => {
      const current = await start(NO_PRLIMIT, { LOG_LEVEL: 'ERROR' });

      expect((await getPath(current.url, '/readyz')).status).toBe(503);
      const answer = await postFile(current.url, 'a.txt', 'x', {
        token: current.token,
      });

      expect(answer.status).toBe(500);
      expect(current.logs).toEqual([]);
    });
  },
);
