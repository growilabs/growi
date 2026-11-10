import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { postFile, recordOf } from './spec-support/extract-client';
import {
  bodyTail,
  fileHead,
  multipartContentType,
} from './spec-support/multipart';
import { requestHead } from './spec-support/raw-http';

// The parent's peak RSS under the heaviest loads the HTTP layer meets
// (research.md 16.9 (d), 20.10, 20.12; Req 3.14): three 50 MiB uploads at
// once, bodies that arrive a byte at a time or alternate 16 KiB and 1 byte
// pieces, and three ~33 MB results at once (5.5 million control characters,
// six bytes each in JSON). The service is the built production parent with
// the real runner and real children, in its own process (spec-support/
// memory-server.mjs). Each ceiling sits below what the shape this guards
// against measured (the 200 body built as one string; small pieces held as
// they arrived), and above what the current shape measured, with room.

vi.setConfig({ testTimeout: 180_000 });

const MIB = 1024 * 1024;
const UPLOADS_CEILING_MIB = 330;
const RESULTS_CEILING_MIB = 440;
const MIXED_CEILING_MIB = 480;
const TRICKLE_GROWTH_CEILING_MIB = 100;
const ALTERNATING_CEILING_MIB = 350;
const SERVER = fileURLToPath(
  new URL('./spec-support/memory-server.mjs', import.meta.url),
);

interface MemoryServer {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  /** The server process's peak RSS so far, in MiB (VmHWM). */
  peakRssMib(): number;
  stop(): Promise<void>;
}

const peakOf = (pid: number): number => {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const kib = Number(/VmHWM:\s+(\d+) kB/.exec(status)?.[1] ?? Number.NaN);
  return Math.ceil(kib / 1024);
};

const firstLine = (child: ChildProcess): Promise<string> =>
  new Promise((resolve, reject) => {
    let out = '';
    child.stdout?.on('data', (data: Buffer) => {
      out += data.toString('utf8');
      const end = out.indexOf('\n');
      if (end !== -1) resolve(out.slice(0, end));
    });
    child.once('exit', (code) =>
      reject(new Error(`the memory server exited (${code}) before listening`)),
    );
  });

let running: MemoryServer | undefined;

const startServer = async (
  env: Readonly<Record<string, string>> = {},
): Promise<MemoryServer> => {
  const token = `memory-${randomBytes(8).toString('hex')}`;
  const child = spawn(
    process.execPath,
    [
      SERVER,
      JSON.stringify({ ATTACHMENT_EXTRACTOR_SERVICE_TOKEN: token, ...env }),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const port = Number(recordOf(JSON.parse(await firstLine(child))).port);
  const pid = child.pid ?? Number.NaN;
  running = {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    peakRssMib: () => peakOf(pid),
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
  return running;
};

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

const statusesOf = async (
  answers: Promise<{ readonly status: number }>[],
): Promise<number[]> => (await Promise.all(answers)).map((a) => a.status);

/** Three uploads at once, `rounds` times; each answer's status. */
const uploadRounds = async (
  target: MemoryServer,
  fileName: string,
  data: Buffer,
  rounds: number,
): Promise<number[]> => {
  const statuses: number[] = [];
  for (let round = 0; round < rounds; round++) {
    statuses.push(
      ...(await statusesOf(
        [1, 2, 3].map(() =>
          postFile(target.url, fileName, data, { token: target.token }),
        ),
      )),
    );
  }
  return statuses;
};

const openNoDelay = (port: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => resolve(socket));
    socket.setNoDelay(true);
    socket.on('error', reject);
  });

const write = (socket: Socket, bytes: Uint8Array): Promise<boolean> =>
  new Promise((resolve) => {
    if (socket.destroyed) resolve(false);
    else socket.write(bytes, (error) => resolve(error == null));
  });

/**
 * One upload of a `fileBytes` file whose content is written as `pieces`
 * (repeated) for at most `forMs`, each write waited for; the socket is then
 * closed. TCP_NODELAY keeps each write its own segment; `paceMs` after each
 * write lets the server read it before the next one lands, so the reads keep
 * the pieces' sizes (checked once by counting the server's chunk sizes).
 */
const sendInPieces = async (
  target: MemoryServer,
  fileBytes: number,
  pieces: readonly Buffer[],
  { forMs, paceMs }: { readonly forMs: number; readonly paceMs: number },
): Promise<number> => {
  const head = fileHead('a.txt');
  const socket = await openNoDelay(target.port);
  socket.on('data', () => {});
  let sent = 0;
  try {
    await write(
      socket,
      Buffer.concat([
        requestHead({
          token: target.token,
          contentType: multipartContentType(),
          contentLength: head.length + fileBytes + bodyTail().length,
        }),
        head,
      ]),
    );
    const until = Date.now() + forMs;
    for (let i = 0; sent < fileBytes && Date.now() < until; i++) {
      const piece = (pieces[i % pieces.length] ?? Buffer.alloc(0)).subarray(
        0,
        fileBytes - sent,
      );
      if (!(await write(socket, piece))) break;
      sent += piece.length;
      if (paceMs > 0) await sleep(paceMs);
    }
    if (sent >= fileBytes) {
      await write(socket, bodyTail());
      await answered(socket, 30_000);
    }
    return sent;
  } finally {
    socket.destroy();
  }
};

/** Resolves once the server sends anything back or closes, or the time is up. */
const answered = (socket: Socket, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    socket.once('data', done);
    socket.once('close', done);
  });

const CONTROL_TEXT = Buffer.alloc(5_500_000, 0x01);
const ALTERNATING = [Buffer.alloc(16 * 1024, 0x61), Buffer.from('b')];

describe.skipIf(process.platform !== 'linux')(
  "the parent's peak RSS (Req 3.14)",
  () => {
    it('three 50 MiB uploads at once, three times', async () => {
      const target = await startServer();

      const statuses = await uploadRounds(
        target,
        'a.bin',
        Buffer.alloc(50 * MIB, 0x61),
        3,
      );

      expect(statuses).toEqual(Array(9).fill(400));
      expect(target.peakRssMib()).toBeLessThanOrEqual(UPLOADS_CEILING_MIB);
    });

    it('three ~33 MB results at once, three times', async () => {
      const target = await startServer();

      const statuses = await uploadRounds(target, 'a.txt', CONTROL_TEXT, 3);

      expect(statuses).toEqual(Array(9).fill(200));
      expect(target.peakRssMib()).toBeLessThanOrEqual(RESULTS_CEILING_MIB);
    });

    it('50 MiB uploads and ~33 MB results, alternating', async () => {
      const target = await startServer();

      for (let round = 0; round < 2; round++) {
        await uploadRounds(target, 'a.bin', Buffer.alloc(50 * MIB, 0x61), 1);
        await uploadRounds(target, 'a.txt', CONTROL_TEXT, 1);
      }

      expect(target.peakRssMib()).toBeLessThanOrEqual(MIXED_CEILING_MIB);
    });

    it('three bodies arriving a byte at a time', async () => {
      const target = await startServer({ UPLOAD_TIMEOUT_S: '5' });
      const idle = target.peakRssMib();

      const sent = await Promise.all(
        [1, 2, 3].map(() =>
          sendInPieces(target, 8 * MIB, [Buffer.from('x')], {
            forMs: 3_000,
            paceMs: 0,
          }),
        ),
      );

      expect(Math.min(...sent)).toBeGreaterThan(256 * 1024);
      expect(target.peakRssMib() - idle).toBeLessThanOrEqual(
        TRICKLE_GROWTH_CEILING_MIB,
      );
    });

    it('three 32 MiB bodies alternating 16 KiB and 1 byte pieces', async () => {
      const target = await startServer();

      const sent = await Promise.all(
        [1, 2, 3].map(() =>
          sendInPieces(target, 32 * MIB, ALTERNATING, {
            forMs: 60_000,
            paceMs: 1,
          }),
        ),
      );

      expect(sent).toEqual(Array(3).fill(32 * MIB));
      expect(target.peakRssMib()).toBeLessThanOrEqual(ALTERNATING_CEILING_MIB);
    });
  },
);
