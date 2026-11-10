import { buildTextPdf, PDF_PAGE_TEXTS } from '../../test/fixtures';
import {
  childPids,
  killStrayChildren,
  STAND_IN_CHILD,
  standInInput,
  waitForOnlyChild,
  waitUntil,
} from '../runner/spec-support';
import {
  type Answer,
  errorOf,
  extractedOf,
  postFile,
} from './spec-support/extract-client';
import { fakeRunner } from './spec-support/fake-runner';
import {
  realRunner,
  type TestService,
  useTestService,
} from './spec-support/test-service';

// The error-table rows that need settings other than the defaults or a child
// that misbehaves, through the real HTTP layer and the real runner (Req 1.3,
// 3.4, 3.6). Python test_e2e_http.py TestSizeAndLimitRowsOverHttp,
// TestInputSizeCapsOverHttp, TestTimeoutRowOverHttp,
// TestChildFailureRowsOverHttp and TestServiceBusyOverHttp. A stand-in child
// (src/runner/spec-support/stand-in-child.mjs, mode in the file's first line)
// takes the place of Python's child_targets.

vi.setConfig({ testTimeout: 60_000 });

const service = useTestService(() => ({ runner: fakeRunner() }));
const MIB = 1024 * 1024;
const CONTENT_MARKER = 'SECRET-CONTENT-MARKER-7f3a';

/** A service whose runner is the real one for `env`, its options replaced by `overrides`. */
const serve = (
  env: Readonly<Record<string, string>>,
  overrides: Parameters<typeof realRunner>[1] = {},
): Promise<TestService> => service.restart(realRunner(env, overrides), env);

const standIn = (
  env: Readonly<Record<string, string>>,
  overrides: Parameters<typeof realRunner>[1] = {},
) => serve(env, { childEntry: STAND_IN_CHILD, ...overrides });

const standInFile = (
  mode: string,
  argument = '-',
  totalBytes?: number,
): Buffer => Buffer.concat(standInInput(mode, { argument, totalBytes }).chunks);

const post = (
  target: TestService,
  fileName: string,
  data: Uint8Array | string,
  mimeType?: string,
): Promise<Answer> =>
  postFile(target.url, fileName, data, { token: target.token, mimeType });

const expectError = (
  answer: Answer,
  status: number,
  code: string,
  kind?: string,
): void => {
  expect(answer.status, answer.text).toBe(status);
  expect(errorOf(answer).keys).toEqual(['code', 'message']);
  expect(errorOf(answer).code).toBe(code);
  if (kind !== undefined) {
    expect(errorOf(answer).message.split(':', 1)[0]).toBe(kind);
  }
};

const noChildLeft = async (): Promise<void> => {
  expect(await waitUntil(() => childPids().length === 0, 5_000)).toBe(true);
};

describe.skipIf(process.platform !== 'linux')(
  'error-table rows that need other settings',
  () => {
    afterEach(killStrayChildren);

    describe('size and limit rows', () => {
      it('a file over MAX_FILE_SIZE_MB is 413; the limit itself is accepted', async () => {
        const target = await serve({ MAX_FILE_SIZE_MB: '1' });

        expectError(
          await post(target, 'big.txt', Buffer.alloc(MIB + 1, 0x78)),
          413,
          'file_too_large',
        );
        expect(
          (await post(target, 'ok.txt', Buffer.alloc(MIB, 0x78))).status,
        ).toBe(200);
      });

      it('a PDF over MAX_PDF_PAGES is 422 limit_exceeded; at the limit it converts', async () => {
        const over = await serve({ MAX_PDF_PAGES: '2' });
        expectError(
          await post(over, 'a.pdf', buildTextPdf(PDF_PAGE_TEXTS)),
          422,
          'resource_limit_exceeded',
          'limit_exceeded',
        );

        const at = await serve({ MAX_PDF_PAGES: '3' });
        expect(
          extractedOf(await post(at, 'a.pdf', buildTextPdf(PDF_PAGE_TEXTS)))
            .pages,
        ).toHaveLength(3);
      });

      it('a result over MAX_RESULT_BYTES is 422 result_too_large; a short one converts', async () => {
        const target = await serve({ MAX_RESULT_BYTES: '1000' });

        expectError(
          await post(target, 'a.txt', 'y'.repeat(5000)),
          422,
          'resource_limit_exceeded',
          'result_too_large',
        );
        expect((await post(target, 'a.txt', 'short')).status).toBe(200);
      });

      it('a child over MAX_CHILD_RSS_MB is 422 memory_exceeded and is gone', async () => {
        const target = await standIn({ MAX_CHILD_RSS_MB: '96' });

        expectError(
          await post(target, 'a.txt', standInFile('grow', '60')),
          422,
          'resource_limit_exceeded',
          'memory_exceeded',
        );
        await noChildLeft();
      });
    });

    describe('CSV / TSV and HTML size caps (Req 3.6)', () => {
      it.each([
        ['a.csv', undefined, 'MAX_CSV_BYTES'],
        ['a.tsv', undefined, 'MAX_CSV_BYTES'],
        ['a.html', undefined, 'MAX_HTML_BYTES'],
        ['a.htm', undefined, 'MAX_HTML_BYTES'],
        ['data', 'text/csv', 'MAX_CSV_BYTES'],
      ])('%s (hint %s) over %s is 422 without a child; at the cap it reaches one', async (fileName, mimeType, setting) => {
        const target = await standIn({ [setting]: '1000' });

        const over = await post(
          target,
          fileName,
          standInFile('echo', '-', 1001),
          mimeType,
        );

        expectError(over, 422, 'resource_limit_exceeded', 'limit_exceeded');
        expect(errorOf(over).message).toBe(
          'limit_exceeded: the document exceeds a processing limit',
        );
        await expect
          .poll(() => target.logs.at(-1) ?? '', { timeout: 2_000 })
          .toMatch(/result=limit_exceeded child_peak_rss_mb=unknown$/);
        const atCap = await post(
          target,
          fileName,
          standInFile('echo', '-', 1000),
          mimeType,
        );
        expect(extractedOf(atCap).pages[0]?.content).toBe(
          'received 1000 bytes',
        );
        await noChildLeft();
      });

      it('formats without a cap are not affected', async () => {
        const target = await standIn({
          MAX_CSV_BYTES: '10',
          MAX_HTML_BYTES: '10',
        });

        for (const name of ['a.xml', 'a.txt', 'a.ipynb', 'a.json']) {
          const answer = await post(
            target,
            name,
            standInFile('echo', '-', 1000),
          );
          expect(extractedOf(answer).pages[0]?.content, name).toBe(
            'received 1000 bytes',
          );
        }
      });

      it('the same CSV converts once it fits the cap', async () => {
        const csv = 'name,qty\napple,3\nbanana,5\n';
        const tight = await serve({ MAX_CSV_BYTES: String(csv.length - 1) });
        expectError(
          await post(tight, 'a.csv', csv),
          422,
          'resource_limit_exceeded',
          'limit_exceeded',
        );

        const fits = await serve({ MAX_CSV_BYTES: String(csv.length) });
        expect(
          extractedOf(await post(fits, 'a.csv', csv)).pages[0]?.content,
        ).toContain('| banana | 5 |');
      });
    });

    describe('timeout rows', () => {
      it('a deadline overrun is 408 timeout, the child is gone and the slot comes back', async () => {
        const target = await standIn(
          { MAX_CONCURRENCY: '1' },
          { timeoutS: 0.5 },
        );
        const began = Date.now();

        expectError(
          await post(target, 'a.txt', standInFile('hang')),
          408,
          'extraction_timeout',
          'timeout',
        );

        expect(Date.now() - began).toBeLessThan(3_500);
        await noChildLeft();
        expect(
          extractedOf(await post(target, 'a.txt', standInFile('echo'))).pages,
        ).toHaveLength(1);
      });

      it('a child that burns CPU past its limit is 408 timeout', async () => {
        const target = await standIn(
          { MAX_CONCURRENCY: '1' },
          { timeoutS: 20 },
        );

        expectError(
          await post(target, 'a.txt', standInFile('cpu-overrun')),
          408,
          'extraction_timeout',
          'timeout',
        );
        await noChildLeft();
      });
    });

    describe('child failure rows', () => {
      it.each([
        'abort',
        'segfault',
        'sigkill',
      ])('a child that dies by %s is 500 crashed, and the service keeps serving', async (mode) => {
        const target = await standIn({ MAX_CONCURRENCY: '1' });

        expectError(
          await post(target, 'a.txt', standInFile(mode)),
          500,
          'extraction_failed',
          'crashed',
        );
        await noChildLeft();
        expect((await post(target, 'a.txt', standInFile('echo'))).status).toBe(
          200,
        );
      });

      it('an unexpected exception in the child is 500 internal, with neither its text nor the content', async () => {
        const target = await standIn({ MAX_CONCURRENCY: '1' });
        const result = JSON.stringify({
          ok: false,
          kind: 'internal',
          detail: 'index out of bounds',
        });
        const file = Buffer.concat([
          standInFile('raw-result', encodeURIComponent(result)),
          Buffer.from(CONTENT_MARKER),
        ]);

        const answer = await post(target, 'a.txt', file);

        expectError(answer, 500, 'extraction_failed', 'internal');
        expect(answer.text).not.toContain('index out of bounds');
        expect(answer.text).not.toContain(CONTENT_MARKER);
      });

      it('a result the parent cannot read is 500', async () => {
        const target = await standIn({});

        const answer = await post(
          target,
          'a.txt',
          standInFile('raw-result', encodeURIComponent('not json at all')),
        );

        expect(answer.status).toBe(500);
        expect(errorOf(answer).code).toBe('extraction_failed');
      });
    });

    describe('service busy row', () => {
      it('while the only slot converts, a second request gets 503 at once; then both slots work again', async () => {
        const target = await standIn({ MAX_CONCURRENCY: '1' });
        const slow = post(target, '4', standInFile('slow-echo', '4000'));
        await waitForOnlyChild(10_000);
        const began = Date.now();

        const probe = await post(target, '0', standInFile('echo'));

        expectError(probe, 503, 'service_busy');
        expect(Date.now() - began).toBeLessThan(2_000);
        expect(extractedOf(await slow).pages[0]?.content).toMatch(
          /^received \d+ bytes$/,
        );
        expect((await post(target, '0', standInFile('echo'))).status).toBe(200);
        await noChildLeft();
      });
    });
  },
);
