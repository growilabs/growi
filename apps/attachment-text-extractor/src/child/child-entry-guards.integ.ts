import { type StdioOptions, spawn } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SPEC_TMP_PREFIX } from '../../test/fixtures/tmp-prefix';
import { encodeChildHeader } from '../wire/child-header';
import { decodeResult, encodeFrameHeader } from '../wire/length-prefixed-json';
import {
  entryHeader,
  entryInput,
  framed,
  INPUT_MARKER,
} from './spec-support/entry-input';

// The real child entry in the two situations direct-child.ts cannot set up:
// under the address-space limit the runner gives it (so an allocation can
// fail), and with fd 4 missing or not a pipe (so the parent watch cannot start).

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(here, 'child-entry.ts');
const PACKAGE_ROOT = path.resolve(here, '../..');
const SWC_REGISTER_URL = pathToFileURL(
  path.join(
    path.dirname(createRequire(import.meta.url).resolve('@swc-node/register')),
    'esm',
    'esm-register.mjs',
  ),
).href;
const MIB = 1024 * 1024;
// The production RLIMIT_AS: (MAX_CHILD_RSS_MB 320 + 2,304) MiB (research.md 19).
const ADDRESS_SPACE_BYTES = (320 + 2304) * MIB;
const PRLIMIT = '/usr/bin/prlimit';

type LivenessSlot = 'pipe' | 'missing' | number;

interface Finished {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** True when the test had to kill it: it did not end by itself. */
  readonly timedOut: boolean;
  readonly result: Buffer;
  readonly logs: string;
}

const collect = (stream: Readable | null | undefined): Promise<Buffer> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    if (stream == null) {
      resolve(Buffer.alloc(0));
      return;
    }
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('error', () => {});
    stream.on('close', () => resolve(Buffer.concat(chunks)));
  });

/** Runs the entry with `input` on fd 0 and waits for it to end (or kills it after `ms`). */
const runEntry = async (
  input: Buffer,
  { liveness = 'pipe', limited = false, ms = 20_000 } = {} as {
    liveness?: LivenessSlot;
    limited?: boolean;
    ms?: number;
  },
): Promise<Finished> => {
  const command = [process.execPath, '--import', SWC_REGISTER_URL, ENTRY];
  const [file, ...args] = limited
    ? [PRLIMIT, `--as=${ADDRESS_SPACE_BYTES}`, '--', ...command]
    : command;
  const stdio: StdioOptions =
    liveness === 'missing'
      ? ['pipe', 'pipe', 'pipe', 'pipe']
      : ['pipe', 'pipe', 'pipe', 'pipe', liveness];
  const child = spawn(file, args, { cwd: PACKAGE_ROOT, env: {}, stdio });
  for (const stream of child.stdio) {
    stream?.on('error', () => {});
  }
  const [stdin, stdout, stderr, resultStream] = child.stdio;
  const outputs = Promise.all([
    collect(resultStream instanceof Readable ? resultStream : null),
    collect(stdout),
    collect(stderr),
  ]);
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, ms);
  const ending = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  stdin?.end(input);
  const { code, signal } = await ending;
  clearTimeout(killer);
  for (const stream of child.stdio) {
    stream?.destroy();
  }
  const [result, out, err] = await outputs;
  return { code, signal, timedOut, result, logs: `${out}${err}` };
};

describe.skipIf(process.platform !== 'linux')(
  'the child entry when something unexpected happens',
  { timeout: 30_000 },
  () => {
    let workDir = '';

    beforeAll(() => {
      workDir = mkdtempSync(path.join(tmpdir(), `${SPEC_TMP_PREFIX}entry-`));
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    // A file frame declared just under 4 GiB passes a header that allows it,
    // then cannot be allocated under RLIMIT_AS: a RangeError the entry did not expect.
    it('sends exactly one internal frame naming only the error class, and exits 1', async () => {
      const input = Buffer.concat([
        framed(encodeChildHeader(entryHeader({ maxInputBytes: 2 ** 32 }))),
        encodeFrameHeader(2 ** 32 - 1),
        Buffer.from(INPUT_MARKER),
      ]);

      const finished = await runEntry(input, { limited: true });

      expect(finished).toMatchObject({
        code: 1,
        signal: null,
        timedOut: false,
      });
      expect(finished.result.length).toBe(4 + finished.result.readUInt32BE(0));
      const outcome = decodeResult(finished.result.subarray(4));
      expect(outcome).toMatchObject({ kind: 'failed', failure: 'internal' });
      if (outcome.kind === 'failed') {
        expect(outcome.detail).toMatch(/^[A-Za-z]+Error$/);
      }
      // The warning code only: the error class stays in the result frame.
      expect(finished.logs).toBe('failed_unexpectedly\n');
    });

    // Without a working watch the child could outlive its parent (Req 3.11),
    // so it must not convert at all.
    it.each<[string, () => LivenessSlot]>([
      ['missing', () => 'missing'],
      ['/dev/null', () => openSync('/dev/null', 'r')],
      [
        'a regular file',
        () => {
          const file = path.join(workDir, 'liveness');
          writeFileSync(file, 'x');
          return openSync(file, 'r');
        },
      ],
    ])('ends without converting when fd 4 is %s', async (_id, liveness) => {
      const slot = liveness();
      try {
        const finished = await runEntry(
          entryInput(entryHeader(), Buffer.from('plain text')),
          { liveness: slot, ms: 10_000 },
        );

        expect(finished).toMatchObject({
          code: null,
          signal: 'SIGKILL',
          timedOut: false,
        });
        expect(finished.result).toEqual(Buffer.alloc(0));
      } finally {
        if (typeof slot === 'number') {
          closeSync(slot);
        }
      }
    });
  },
);
