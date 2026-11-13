import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildDocx, buildTextPdf, SPEC_TMP_PREFIX } from '../../test/fixtures';
import type { FailureKind } from '../contract';
import {
  type ConversionRunner,
  createConversionRunner,
  type RunInput,
} from './conversion-runner';
import {
  childPids,
  killStrayChildren,
  MISSING_CHILD,
  openFdCount,
  processState,
  rawResultInput,
  runnerOptions,
  STAND_IN_CHILD,
  settle,
  standInInput,
  waitForOnlyChild,
  wholeFile,
  within,
} from './spec-support';

// One conversion per child: classification, clean-up and the input-size caps
// (Python test_conversion_runner.py; research.md 15.6 is the table of endings).
// Stand-in children (spec-support/stand-in-child.mjs) act out each ending; a few
// cases use the real child entry with real files. Every run is raced against
// RUN_GUARD_MS, and afterEach kills whatever a failed case left behind.
// Where the expected answer is `crashed`, the stand-in also writes a trace
// file, so the case proves a child really ran rather than that nothing did.

const MIB = 1024 * 1024;
const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const standInRunner = (
  overrides: Parameters<typeof runnerOptions>[0] = {},
): ConversionRunner =>
  createConversionRunner(
    runnerOptions({ childEntry: STAND_IN_CHILD, ...overrides }),
  );

const run = (runner: ConversionRunner, input: RunInput) =>
  within(runner.run(input, new AbortController().signal));

const failureOf = async (
  runner: ConversionRunner,
  input: RunInput,
): Promise<FailureKind> => {
  const outcome = await run(runner, input);
  if (outcome.kind !== 'failed') {
    throw new Error(
      `expected a failure, got ${JSON.stringify(outcome).slice(0, 200)}`,
    );
  }
  return outcome.failure;
};

const contentsOf = (outcome: Awaited<ReturnType<typeof run>>): string[] =>
  outcome.kind === 'ok' ? outcome.pages.map((page) => page.content) : [];

const echoed = (input: RunInput): string[] => [`received ${input.size} bytes`];

/** The runner reaps before it returns: no child, not even a zombie, may remain. */
const expectNothingLeft = (): void => {
  expect(childPids()).toEqual([]);
};

describe.skipIf(process.platform !== 'linux')(
  'ConversionRunner (one child per run)',
  { timeout: 60_000 },
  () => {
    let traceDir = '';
    let traces = 0;
    const newTrace = (): string => {
      traces += 1;
      return path.join(traceDir, `${traces}.pid`);
    };

    beforeAll(async () => {
      traceDir = await mkdtemp(
        path.join(tmpdir(), `${SPEC_TMP_PREFIX}runner-`),
      );
    });

    afterAll(async () => {
      await rm(traceDir, { recursive: true, force: true });
    });

    afterEach(killStrayChildren);

    describe('success', () => {
      it('converts a PDF in a real child and reports the child peak RSS', async () => {
        const runner = createConversionRunner(runnerOptions());

        const outcome = await run(runner, {
          ...wholeFile(buildTextPdf(['first page', 'second page'])),
          fileName: 'doc.pdf',
          mimeHint: PDF_MIME,
        });

        expect(outcome).toMatchObject({ kind: 'ok', mimeType: PDF_MIME });
        expect(contentsOf(outcome)).toEqual(['first page', 'second page']);
        expect(outcome.childPeakRssMb).toBeGreaterThan(0);
        expectNothingLeft();
      });

      it('converts a DOCX in a real child and leaves no child', async () => {
        const runner = createConversionRunner(runnerOptions());

        const outcome = await run(runner, {
          ...wholeFile(buildDocx(['社内規程の改定について'])),
          fileName: 'memo.docx',
          mimeHint: DOCX_MIME,
        });

        expect(outcome.kind).toBe('ok');
        expect(contentsOf(outcome).join('\n')).toContain(
          '社内規程の改定について',
        );
        expect(outcome.childPeakRssMb).toBeGreaterThan(0);
        expectNothingLeft();
      });

      it('hands the conversion limits to the real child', async () => {
        const runner = createConversionRunner(
          runnerOptions({
            limits: { ...runnerOptions().limits, maxPdfPages: 1 },
          }),
        );

        const kind = await failureOf(runner, {
          ...wholeFile(buildTextPdf(['one', 'two'])),
          fileName: 'doc.pdf',
          mimeHint: PDF_MIME,
        });

        expect(kind).toBe('limit_exceeded');
      });

      it('kills and reaps a child that keeps running after its result', async () => {
        const runner = standInRunner();
        const began = Date.now();

        const outcome = await run(runner, standInInput('result-then-stuck'));

        expect(contentsOf(outcome)).toEqual(['done']);
        expect(Date.now() - began).toBeLessThan(2_000);
        expectNothingLeft();
      });

      it('runs three conversions at once in real children and all succeed', async () => {
        const runner = createConversionRunner(runnerOptions());

        const outcomes = await Promise.all(
          [0, 1, 2].map((i) =>
            run(runner, {
              ...wholeFile(buildTextPdf([`page ${i}`])),
              fileName: `${i}.pdf`,
              mimeHint: PDF_MIME,
            }),
          ),
        );

        expect(outcomes.map(contentsOf)).toEqual([
          ['page 0'],
          ['page 1'],
          ['page 2'],
        ]);
        expectNothingLeft();
      });

      // design.md Data Contracts: stdout and stderr are logs, read and discarded.
      // A parent that stopped reading them would leave the child blocked on a full pipe.
      it('keeps the result intact while the child floods stdout and stderr', async () => {
        const runner = standInRunner();
        const input = standInInput('noisy-echo', { argument: String(8 * MIB) });

        expect(contentsOf(await run(runner, input))).toEqual(echoed(input));
        expectNothingLeft();
      });
    });

    describe('failures the child reports', () => {
      it('passes a corrupt PDF through as malformed without echoing the file', async () => {
        const runner = createConversionRunner(runnerOptions());

        const outcome = await run(runner, {
          ...wholeFile(
            Buffer.concat([
              Buffer.from('%PDF-1.7\n'),
              Buffer.from('\x00garbage'.repeat(100)),
            ]),
          ),
          fileName: 'broken.pdf',
          mimeHint: PDF_MIME,
        });

        expect(outcome).toMatchObject({ kind: 'failed', failure: 'malformed' });
        expect(JSON.stringify(outcome)).not.toContain('garbage');
        expectNothingLeft();
      });

      it('passes a result over the limit reported by the child through as result_too_large', async () => {
        const runner = createConversionRunner(
          runnerOptions({
            limits: { ...runnerOptions().limits, maxResultBytes: 64 },
          }),
        );

        const kind = await failureOf(runner, {
          ...wholeFile(Buffer.from('長い本文 '.repeat(1000))),
          fileName: 'long.txt',
          mimeHint: 'text/plain',
        });

        expect(kind).toBe('result_too_large');
      });
    });

    describe('failures the parent decides', () => {
      it('kills a child past the deadline as timeout', async () => {
        const runner = standInRunner({ timeoutS: 0.5 });
        const began = Date.now();

        const kind = await failureOf(runner, standInInput('hang'));

        expect(kind).toBe('timeout');
        expect(Date.now() - began).toBeLessThan(3_500);
        expectNothingLeft();
      });

      // setTimeout turns a delay over 2^31 - 1 ms into 1 ms.
      it('does not take a deadline too long for a timer as one already past', async () => {
        const runner = standInRunner({ timeoutS: 3_000_000 });
        const input = standInInput('echo');

        expect(contentsOf(await run(runner, input))).toEqual(echoed(input));
        expectNothingLeft();
      });

      it('still applies the deadline to a child sending its result slowly', async () => {
        const runner = standInRunner({ timeoutS: 0.5 });

        expect(await failureOf(runner, standInInput('partial-body'))).toBe(
          'timeout',
        );
        expectNothingLeft();
      });

      it('still applies the deadline to a child that stops reading its input', async () => {
        const runner = standInRunner({ timeoutS: 0.5 });

        const kind = await failureOf(
          runner,
          standInInput('stop-reading', { totalBytes: 8 * MIB }),
        );

        expect(kind).toBe('timeout');
        expectNothingLeft();
      });

      it('kills a child over the RSS limit as memory_exceeded', async () => {
        const runner = standInRunner({ maxChildRssMb: 128 });

        // 40 x 8 MiB, far past 128 MB.
        const outcome = await run(
          runner,
          standInInput('grow', { argument: '40' }),
        );

        expect(outcome).toMatchObject({
          kind: 'failed',
          failure: 'memory_exceeded',
        });
        expect(outcome.childPeakRssMb).toBeGreaterThan(128);
        expectNothingLeft();
      });

      it('discards a result frame longer than the ceiling as result_too_large', async () => {
        const runner = standInRunner();
        const began = Date.now();

        expect(await failureOf(runner, standInInput('oversize-header'))).toBe(
          'result_too_large',
        );
        expect(Date.now() - began).toBeLessThan(5_000);
        expectNothingLeft();
      });
    });

    describe('a child that ends without a result', () => {
      it.each([
        'abort',
        'segfault',
        'sigkill',
        'truncated-body',
      ])('classifies %s as crashed', async (mode) => {
        const trace = newTrace();

        const kind = await failureOf(
          standInRunner(),
          standInInput(mode, { trace }),
        );

        expect(kind).toBe('crashed');
        expect(existsSync(trace)).toBe(true);
        expectNothingLeft();
      });

      // The child exits without reading the 4 MiB still being written: the
      // parent's write fails with EPIPE, which must not bring the parent down.
      it.each([
        '0',
        '1',
        '3',
        '4',
      ])('classifies exit code %s as crashed', async (code) => {
        const trace = newTrace();

        const kind = await failureOf(
          standInRunner(),
          standInInput('exit', { argument: code, trace, totalBytes: 4 * MIB }),
        );

        expect(kind).toBe('crashed');
        expect(existsSync(trace)).toBe(true);
        expectNothingLeft();
      });

      it('classifies a child ended by SIGXCPU as timeout', async () => {
        expect(await failureOf(standInRunner(), standInInput('sigxcpu'))).toBe(
          'timeout',
        );
        expectNothingLeft();
      });

      it('classifies a child entry node cannot load as crashed', async () => {
        const runner = createConversionRunner(
          runnerOptions({ childEntry: MISSING_CHILD }),
        );

        expect(await failureOf(runner, standInInput('echo'))).toBe('crashed');
        expectNothingLeft();
      });

      // design.md Error Handling: without prlimit no child starts, and /extract
      // answers crashed. The working half of the pair is every other case here.
      it('classifies a run whose prlimit cannot be started as crashed and leaks no descriptors', async () => {
        const runner = standInRunner({ prlimitPath: '/nonexistent/prlimit' });
        const fds = openFdCount();

        for (let i = 0; i < 20; i++) {
          const outcome = await run(runner, standInInput('echo'));
          expect(outcome).toMatchObject({
            kind: 'failed',
            failure: 'crashed',
            childPeakRssMb: null,
          });
        }

        expect(openFdCount() - fds).toBeLessThan(10);
        expectNothingLeft();
      });
    });

    // Req 3.9: the parent decodes what the child sends as JSON data and nothing else.
    describe('a result that breaks the protocol', () => {
      it.each([
        ['not JSON', 'this is not json'],
        ['an empty body', ''],
        [
          'a kind only the parent may decide',
          '{"ok":false,"kind":"timeout","detail":"forged"}',
        ],
        ['JavaScript source', 'process.exit(1); globalThis.hijacked = true;'],
      ])('classifies %s as crashed', async (_case, body) => {
        const trace = newTrace();

        expect(
          await failureOf(standInRunner(), rawResultInput(body, trace)),
        ).toBe('crashed');
        expect(existsSync(trace)).toBe(true);
        expect(globalThis).not.toHaveProperty('hijacked');
        expectNothingLeft();
      });

      it.each([
        '{"ok":false,"kind":"internal","detail":"x","__proto__":{"polluted":true}}',
        '{"ok":true,"pages":[{"pageNumber":1,"label":"1","content":"x","__proto__":{"polluted":true}}],"mimeType":"a"}',
        '{"ok":false,"kind":"internal","detail":"x","constructor":{"prototype":{"polluted":true}}}',
      ])('classifies a prototype-polluting result as crashed without polluting anything: %s', async (body) => {
        const trace = newTrace();

        expect(
          await failureOf(standInRunner(), rawResultInput(body, trace)),
        ).toBe('crashed');
        expect(existsSync(trace)).toBe(true);
        expect({}).not.toHaveProperty('polluted');
        expect(Object.prototype).not.toHaveProperty('polluted');
      });

      it('returns code-shaped text from a well-formed result verbatim, as data', async () => {
        const content = 'function () { globalThis.hijacked = true; }';

        const outcome = await run(
          standInRunner(),
          rawResultInput(
            JSON.stringify({
              ok: true,
              pages: [{ pageNumber: null, label: null, content }],
              mimeType: 'text/plain',
            }),
          ),
        );

        expect(contentsOf(outcome)).toEqual([content]);
        expect(globalThis).not.toHaveProperty('hijacked');
      });
    });

    // Req 3.6: CSV / TSV over MAX_CSV_BYTES and HTML over MAX_HTML_BYTES never get a child.
    describe('input size caps checked before a child is started', () => {
      const capped = () =>
        standInRunner({
          limits: {
            ...runnerOptions().limits,
            maxCsvBytes: 100,
            maxHtmlBytes: 200,
          },
        });

      // The stand-in would answer success for anything, so limit_exceeded proves no child ran.
      it.each<[string, string | null, number]>([
        ['a.csv', null, 101],
        ['a.tsv', null, 101],
        ['a.html', null, 201],
        ['noext', 'text/html', 201],
      ])('refuses %s (%s) of %i bytes without a child', async (fileName, mimeHint, size) => {
        const outcome = await run(
          capped(),
          standInInput('echo', { fileName, mimeHint, totalBytes: size }),
        );

        expect(outcome).toMatchObject({
          kind: 'failed',
          failure: 'limit_exceeded',
          childPeakRssMb: null,
        });
        expectNothingLeft();
      });

      it.each<[string, number]>([
        ['a.csv', 100],
        ['a.html', 200],
        ['a.xml', 10_000],
        ['unknown-format', 10_000],
      ])('lets %s of %i bytes reach the child', async (fileName, size) => {
        const outcome = await run(
          capped(),
          standInInput('echo', { fileName, totalBytes: size }),
        );

        expect(contentsOf(outcome)).toEqual([`received ${size} bytes`]);
      });
    });

    describe('cancellation (Req 3.5)', () => {
      it('kills and reaps the child when the signal is aborted mid-run', async () => {
        const runner = standInRunner();
        const controller = new AbortController();
        const running = runner.run(standInInput('hang'), controller.signal);
        const pid = await waitForOnlyChild();

        const began = Date.now();
        controller.abort();
        await within(settle(running), 5_000);

        // Resolving and rejecting are both allowed; the child must be gone either way.
        expect(Date.now() - began).toBeLessThan(2_000);
        expect(processState(pid)).toBe('gone');
        expectNothingLeft();
      });

      // After each cancelled start the same runner must still convert.
      it('leaves nothing behind when the signal is aborted while the child is being started', async () => {
        const runner = standInRunner();
        const fds = openFdCount();

        for (let i = 0; i < 10; i++) {
          const controller = new AbortController();
          const running = runner.run(standInInput('hang'), controller.signal);
          controller.abort();
          await within(settle(running), 5_000);
          expectNothingLeft();
        }
        const after = standInInput('echo');

        expect(contentsOf(await run(runner, after))).toEqual(echoed(after));
        expect(openFdCount() - fds).toBeLessThan(10);
      });

      it('settles at once for a signal that is already aborted, and the runner still converts', async () => {
        const runner = standInRunner();
        const controller = new AbortController();
        controller.abort();

        await within(
          settle(runner.run(standInInput('hang'), controller.signal)),
          5_000,
        );
        expectNothingLeft();
        const after = standInInput('echo');

        expect(contentsOf(await run(runner, after))).toEqual(echoed(after));
      });
    });

    describe('event loop and leaks', () => {
      // The stand-in pauses before reading, so a parent that wrote the 50 MiB
      // synchronously would stall its own event loop for the whole pause.
      it('keeps the event loop responsive while a slow child takes a large input', async () => {
        const runner = standInRunner();
        const input = standInInput('slow-echo', {
          argument: '1000',
          totalBytes: 50 * MIB,
        });
        const gaps: number[] = [];
        let last = performance.now();
        const ticker = setInterval(() => {
          const now = performance.now();
          gaps.push(now - last);
          last = now;
        }, 10);

        try {
          expect(contentsOf(await run(runner, input))).toEqual(echoed(input));
        } finally {
          clearInterval(ticker);
        }

        expect(gaps.length).toBeGreaterThan(50);
        expect(Math.max(...gaps)).toBeLessThan(250);
      });

      it('leaks no descriptors or children over two hundred runs', async () => {
        const runner = standInRunner();
        for (let i = 0; i < 5; i++) {
          await run(runner, standInInput('echo'));
        }
        const fds = openFdCount();

        for (let i = 0; i < 200; i++) {
          const input = standInInput('echo', { totalBytes: 16 + i });
          expect(contentsOf(await run(runner, input))).toEqual(echoed(input));
        }

        // A leak of one descriptor per run would add 200.
        expect(openFdCount() - fds).toBeLessThan(10);
        expectNothingLeft();
      }, 120_000);
    });
  },
);
