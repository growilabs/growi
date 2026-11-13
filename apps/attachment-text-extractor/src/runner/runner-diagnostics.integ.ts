import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEC_TMP_PREFIX } from '../../test/fixtures/tmp-prefix';
import { createLeveledLog } from '../config/leveled-log';
import type { LogLevel } from '../config/load-settings';
import {
  CHILD_WARNING_CODES,
  MAX_CHILD_WARNING_BYTES,
} from '../wire/child-warning';
import {
  type ConversionRunner,
  type ConversionRunnerOptions,
  createConversionRunner,
  type RunInput,
} from './conversion-runner';
import {
  killStrayChildren,
  MISSING_CHILD,
  rawResultInput,
  runnerOptions,
  SILENT_CHILD,
  STAND_IN_CHILD,
  standInInput,
  within,
} from './spec-support';

// research.md 7.8: the lines the runner writes for the operator. Why a child
// could not be started or ended without a result, what a child warned about,
// and why the service is not ready. Every line is the parent's own fixed text
// with fixed fields: the child is untrusted, and /readyz needs no token.

const here = path.dirname(fileURLToPath(import.meta.url));
const UNRELATED_ANSWER_CHILD = {
  path: path.join(here, 'spec-support', 'unrelated-answer-child.mjs'),
  nodeArgs: [],
};
const MIB = 1024 * 1024;
const NOT_STARTED = 'WARNING conversion child could not be started:';
const UNRECOGNISED =
  'WARNING conversion child warning: wrote unrecognised output to its standard error';
const SENTENCES: Readonly<Record<string, string>> = {
  oom_score_not_raised:
    'WARNING conversion child warning: could not raise its oom_score_adj',
  invalid_input_frame:
    'WARNING conversion child warning: received an invalid input frame',
  result_not_sent:
    'WARNING conversion child warning: could not send its result',
  failed_unexpectedly: 'WARNING conversion child warning: failed unexpectedly',
};
// A time stamp, a level, then printable ASCII only: no line break, no escape.
const LINE =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z ((?:INFO|WARNING|ERROR) [ -~]+)$/;

interface Capture {
  readonly runner: ConversionRunner;
  /** Each line without its time stamp; throws on a line of any other shape. */
  readonly lines: () => string[];
  readonly raw: readonly string[];
}

const capture = (
  overrides: Partial<ConversionRunnerOptions> = {},
  level: LogLevel = 'INFO',
): Capture => {
  const raw: string[] = [];
  const runner = createConversionRunner(
    runnerOptions(overrides),
    createLeveledLog(level, (line) => raw.push(line)),
  );
  return {
    runner,
    raw,
    lines: () =>
      raw.map((line) => {
        const body = LINE.exec(line)?.[1];
        if (body === undefined) {
          throw new Error(`not a log line: ${JSON.stringify(line)}`);
        }
        return body;
      }),
  };
};

const standIn = (
  overrides: Partial<ConversionRunnerOptions> = {},
  level: LogLevel = 'INFO',
): Capture => capture({ childEntry: STAND_IN_CHILD, ...overrides }, level);

const run = (runner: ConversionRunner, input: RunInput) =>
  within(runner.run(input, new AbortController().signal));

/** A stand-in that writes `text` to its standard error `repeat` times, then answers. */
const stderrInput = (text: string, repeat = 1): RunInput =>
  standInInput('stderr-echo', {
    argument: `${repeat}x${encodeURIComponent(text)}`,
  });

const ask = async (runner: ConversionRunner, times: number) => {
  const answers: boolean[] = [];
  for (let asked = 0; asked < times; asked += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: one probe after the other, as separate /readyz calls
    answers.push((await within(runner.readiness())).ready);
  }
  return answers;
};

describe.skipIf(process.platform !== 'linux')(
  'the runner diagnostics',
  { timeout: 60_000 },
  () => {
    let workDir = '';

    beforeAll(() => {
      workDir = mkdtempSync(path.join(tmpdir(), `${SPEC_TMP_PREFIX}diag-`));
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    afterEach(killStrayChildren);

    describe('a conversion whose child gives no result', () => {
      it.each([
        ['is missing', '/nonexistent/prlimit', 'ENOENT'],
        ['is not executable', fileURLToPath(import.meta.url), 'EACCES'],
        ['is a directory', '/usr/bin', 'EACCES'],
      ])('names the start failure when prlimit %s', async (_case, prlimitPath, code) => {
        const { runner, lines } = standIn({ prlimitPath });

        const outcome = await run(runner, standInInput('echo'));

        expect(outcome).toMatchObject({ kind: 'failed', failure: 'crashed' });
        expect(lines()).toEqual([
          `${NOT_STARTED} launcher=prlimit error=${code}`,
        ]);
      });

      it('names the exit code', async () => {
        const { runner, lines } = standIn();

        await run(runner, standInInput('exit', { argument: '3' }));

        expect(lines()).toEqual([
          'WARNING conversion child exited without a result: exit_code=3',
        ]);
      });

      it.each([
        ['sigkill', 'SIGKILL', 'crashed'],
        ['sigxcpu', 'SIGXCPU', 'timeout'],
      ])('names the signal (%s)', async (mode, signal, failure) => {
        const { runner, lines } = standIn();

        const outcome = await run(runner, standInInput(mode));

        expect(outcome).toMatchObject({ kind: 'failed', failure });
        expect(lines()).toEqual([
          `WARNING conversion child was killed by a signal: signal=${signal}`,
        ]);
      });

      it('says that the result was invalid, and nothing of it', async () => {
        const { runner, lines } = standIn();

        await run(runner, rawResultInput('{"ok":true,"secret":"MARKER-77"}'));

        expect(lines()).toEqual([
          'WARNING conversion child sent an invalid result',
        ]);
      });
    });

    describe('a conversion the result line already explains', () => {
      it('adds no line for a success', async () => {
        const { runner, raw } = standIn();

        expect((await run(runner, standInInput('echo'))).kind).toBe('ok');
        expect(raw).toEqual([]);
      });

      it('adds no line for a failure the child reports', async () => {
        const { runner, raw } = standIn();

        const outcome = await run(
          runner,
          rawResultInput('{"ok":false,"kind":"malformed","detail":"x"}'),
        );

        expect(outcome).toMatchObject({ kind: 'failed', failure: 'malformed' });
        expect(raw).toEqual([]);
      });

      it('adds no line when the parent stops the child at the deadline', async () => {
        const { runner, raw } = standIn({ timeoutS: 0.3 });

        const outcome = await run(runner, standInInput('hang'));

        expect(outcome).toMatchObject({ kind: 'failed', failure: 'timeout' });
        expect(raw).toEqual([]);
      });
    });

    describe('what a child writes to its standard error', () => {
      it.each(
        CHILD_WARNING_CODES,
      )('logs its own sentence for %s', async (code) => {
        const { runner, lines } = standIn();

        const outcome = await run(runner, stderrInput(`${code}\n`));

        expect(outcome.kind).toBe('ok');
        expect(lines()).toEqual([SENTENCES[code]]);
      });

      it('logs one fixed line for anything else, and none of the text', async () => {
        const { runner, lines, raw } = standIn();

        await run(
          runner,
          stderrInput('SECRET-CONTENT-MARKER-7f3a in a.docx\n'),
        );

        expect(lines()).toEqual([UNRECOGNISED]);
        expect(raw.join('\n')).not.toContain('MARKER');
      });

      it('writes nothing of megabytes of hostile text, and at most the closed set of lines', async () => {
        const { runner, lines, raw } = standIn();
        const forged =
          '2026-11-11T00:00:00.000Z INFO extract format=pdf size=1 duration_ms=1 result=ok child_peak_rss_mb=1';
        const hostile = [
          'oom_score_not_raised',
          `\x1b[2J\x1b[31mSECRET-CONTENT-MARKER-7f3a\r`,
          forged,
          '/srv/internal/path/SECRET-FILE-NAME-MARKER-91c2.docx',
          'A'.repeat(MAX_CHILD_WARNING_BYTES),
          // A known code, but past the bytes the parent keeps.
          'result_not_sent',
          '',
        ].join('\n');
        const repeat = Math.ceil((8 * MIB) / hostile.length);
        const input = stderrInput(hostile, repeat);

        const outcome = await run(runner, input);

        expect(outcome).toMatchObject({
          kind: 'ok',
          pages: [{ content: `received ${input.size} bytes` }],
        });
        // The first code is inside the bytes the parent keeps; the rest is not text it knows.
        expect(lines()).toEqual([SENTENCES.oom_score_not_raised, UNRECOGNISED]);
        const everything = raw.join('\n');
        expect(everything).not.toContain('MARKER');
        expect(everything).not.toContain('extract format=');
        expect(everything).not.toContain('/srv/');
      });

      it('never writes more lines than the closed set has entries', async () => {
        const { runner, lines } = standIn();
        const all = CHILD_WARNING_CODES.map((code) => `${code}\n`).join('');

        await run(runner, stderrInput(`${all}junk\n${all}`, 50));

        expect(lines()).toEqual([
          ...CHILD_WARNING_CODES.map((code) => SENTENCES[code]),
          UNRECOGNISED,
        ]);
      });
    });

    describe('LOG_LEVEL', () => {
      it('ERROR leaves the warnings out and changes no outcome', async () => {
        const { runner, raw } = standIn(
          { prlimitPath: '/nonexistent/prlimit' },
          'ERROR',
        );

        const outcome = await run(runner, standInInput('echo'));
        const ready = await ask(runner, 1);

        expect(outcome).toMatchObject({ kind: 'failed', failure: 'crashed' });
        expect(ready).toEqual([false]);
        expect(raw).toEqual([]);
      });
    });

    describe('readiness', () => {
      const NOT_READY = 'WARNING readiness probe failed:';

      it('writes nothing while the service is ready', async () => {
        const { runner, raw } = capture();

        expect(await ask(runner, 2)).toEqual([true, true]);
        expect(raw).toEqual([]);
      });

      it('says why once per change, not once per call', async () => {
        const prlimitPath = path.join(workDir, 'prlimit');
        const { runner, lines } = capture({ prlimitPath });
        const missing = `${NOT_READY} probe=pdf cause=not_started launcher=prlimit error=ENOENT`;
        const notExecutable = `${NOT_READY} probe=pdf cause=not_started launcher=prlimit error=EACCES`;
        const back = 'INFO readiness probe passed again';

        expect(await ask(runner, 4)).toEqual([false, false, false, false]);
        expect(lines()).toEqual([missing]);

        symlinkSync('/usr/bin/prlimit', prlimitPath);
        expect(await ask(runner, 3)).toEqual([true, true, true]);
        expect(lines()).toEqual([missing, back]);

        rmSync(prlimitPath);
        writeFileSync(prlimitPath, 'not a program');
        expect(await ask(runner, 3)).toEqual([false, false, false]);
        expect(lines()).toEqual([missing, back, notExecutable]);

        rmSync(prlimitPath);
        expect(await ask(runner, 2)).toEqual([false, false]);
        expect(lines()).toEqual([missing, back, notExecutable, missing]);
      });

      it('writes one line for callers that ask at the same time', async () => {
        const { runner, lines } = capture({
          prlimitPath: '/nonexistent/prlimit',
        });

        await within(
          Promise.all(Array.from({ length: 10 }, () => runner.readiness())),
        );
        await ask(runner, 2);

        expect(lines()).toHaveLength(1);
      });

      it('names the failure kind when the probe child never answers', async () => {
        const { runner, lines } = capture({
          childEntry: SILENT_CHILD,
          probeTimeoutS: 1,
        });

        expect(await ask(runner, 2)).toEqual([false, false]);
        expect(lines()).toEqual([
          `${NOT_READY} probe=pdf cause=failed result=timeout`,
        ]);
      });

      it('says when the probe child answers without the probe text', async () => {
        const { runner, lines } = capture({
          childEntry: UNRELATED_ANSWER_CHILD,
        });

        expect(await ask(runner, 2)).toEqual([false, false]);
        expect(lines()).toEqual([
          `${NOT_READY} probe=pdf cause=unexpected_text`,
        ]);
      });

      it('names the exit code when the probe child cannot load its entry, and repeats no child warning', async () => {
        const { runner, lines } = capture({ childEntry: MISSING_CHILD });

        expect(await ask(runner, 5)).toEqual([
          false,
          false,
          false,
          false,
          false,
        ]);

        const written = lines();
        expect(written.filter((line) => line.startsWith(NOT_READY))).toEqual([
          `${NOT_READY} probe=pdf cause=exit_code exit_code=1`,
        ]);
        // node prints its own error; whether it is read before the exit is not certain.
        expect(written.filter((line) => line !== UNRECOGNISED)).toHaveLength(1);
        expect(written.length).toBeLessThanOrEqual(2);
      });

      it('leaves the "passed again" line out at WARNING', async () => {
        const prlimitPath = path.join(workDir, 'prlimit-at-warning');
        const { runner, lines } = capture({ prlimitPath }, 'WARNING');

        await ask(runner, 1);
        symlinkSync('/usr/bin/prlimit', prlimitPath);
        expect(await ask(runner, 1)).toEqual([true]);

        expect(lines()).toHaveLength(1);
        expect(lines()[0]).toContain(NOT_READY);
      });
    });
  },
);
