import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable, type Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Starts a child-side script directly, with the same five stdio slots the
// runner gives a child (design.md Data Contracts): 0 input frames, 1/2 logs,
// 3 the result frame, 4 the liveness pipe the parent never writes to.
// No prlimit here: these tests are about what the child does by itself.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../..');
const PACKAGE_ROOT = path.resolve(SRC, '..');
const SWC_REGISTER_URL = pathToFileURL(
  path.join(
    path.dirname(createRequire(import.meta.url).resolve('@swc-node/register')),
    'esm',
    'esm-register.mjs',
  ),
).href;

export interface Ending {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface DirectChild {
  readonly process: ChildProcess;
  readonly pid: number;
  readonly input: Writable;
  /** Everything the child writes to fd 3, once fd 3 has closed. */
  readonly result: Promise<Buffer>;
  /** The first line the child prints on stdout. */
  readonly firstLine: Promise<string>;
  readonly ended: Promise<Ending>;
  /** Closes the parent's end of the liveness pipe, as a dying parent would. */
  dropLiveness(): void;
  /** Kills the child if it still runs and waits for it; for afterEach. */
  dispose(): Promise<void>;
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

/** Runs a TypeScript file under src/ (path relative to src/) as a child. */
export const spawnDirect = (
  relativeToSrc: string,
  args: readonly string[] = [],
): DirectChild => {
  const child = spawn(
    process.execPath,
    ['--import', SWC_REGISTER_URL, path.join(SRC, relativeToSrc), ...args],
    {
      cwd: PACKAGE_ROOT,
      env: {},
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    },
  );
  for (const stream of child.stdio) {
    stream?.on('error', () => {});
  }
  const [input, stdout, , resultStream, liveness] = child.stdio;
  if (child.pid === undefined || input == null || !('write' in input)) {
    throw new Error('the child could not be started');
  }
  const ended = new Promise<Ending>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  const firstLine = new Promise<string>((resolve, reject) => {
    let text = '';
    stdout?.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const newline = text.indexOf('\n');
      if (newline >= 0) {
        resolve(text.slice(0, newline));
      }
    });
    child.on('exit', () => reject(new Error(`no line before exit: ${text}`)));
  });
  firstLine.catch(() => {});
  return {
    process: child,
    pid: child.pid,
    input,
    result: collect(resultStream instanceof Readable ? resultStream : null),
    firstLine,
    ended,
    dropLiveness: () => liveness?.destroy(),
    dispose: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await ended;
      for (const stream of child.stdio) {
        stream?.destroy();
      }
    },
  };
};

/** The ending, or 'still running' if the child has not ended in time. */
export const endingWithin = async (
  child: DirectChild,
  ms: number,
): Promise<Ending | 'still running'> => {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'still running'>((resolve) => {
    timer = setTimeout(() => resolve('still running'), ms);
  });
  try {
    return await Promise.race([child.ended, late]);
  } finally {
    clearTimeout(timer);
  }
};
