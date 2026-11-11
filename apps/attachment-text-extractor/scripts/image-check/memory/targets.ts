import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { Service } from './loads';

// Where the measured service runs: the image in a container (the numbers
// tasks 6.12 asks for), or `node dist/main.js` on this machine (a stand-in
// when there is no docker; its numbers are not the image's).

const TOKEN_NAME = 'ATTACHMENT_EXTRACTOR_SERVICE_TOKEN';
const MIB = 1024 * 1024;

export interface MemoryReading {
  readonly totalMib: number;
  /** Without the page cache the kernel can drop; null when not known. */
  readonly workingSetMib: number | null;
}

export interface RunningTarget extends Service {
  read(): Promise<MemoryReading>;
  /**
   * The highest total since the start, as the platform recorded it; null
   * where the platform has no such record at all. Fails when it should have
   * one and it cannot be read: the polled readings alone miss short peaks.
   */
  recordedPeakMib(): Promise<number | null>;
  logs(): Promise<string>;
  stop(): Promise<void>;
}

export interface Target {
  /** Printed with the numbers. */
  readonly where: string;
  start(): Promise<RunningTarget>;
}

const run = promisify(execFile);
const toMib = (bytes: number): number => Math.ceil(bytes / MIB);

const CGROUP = '/sys/fs/cgroup';

const cgroupReading = (text: string): MemoryReading => {
  const [current = '', ...stat] = text.split('\n');
  const inactiveFile = stat
    .find((line) => line.startsWith('inactive_file '))
    ?.split(' ')[1];
  const total = Number(current);
  if (current === '' || !Number.isFinite(total)) {
    throw new Error(`not a cgroup v2 memory.current reading: ${current}`);
  }
  return {
    totalMib: toMib(total),
    workingSetMib:
      inactiveFile === undefined ? null : toMib(total - Number(inactiveFile)),
  };
};

export interface DockerTargetOptions {
  readonly image: string;
  readonly containerName: string;
  readonly hostPort: number;
}

/**
 * The image as production runs it (read-only rootfs, uid 10001, no
 * capabilities), except for the network: the load comes from outside the
 * container so that the client's memory is not counted, which needs a
 * published port (loopback only).
 */
export const dockerTarget = ({
  image,
  containerName,
  hostPort,
}: DockerTargetOptions): Target => ({
  where: `inside the image ${image}: the container's cgroup v2 memory.peak (and memory.current, polled)`,
  start: async () => {
    const token = randomBytes(16).toString('hex');
    await run(
      'docker',
      [
        'run',
        '-d',
        '--name',
        containerName,
        '--read-only',
        '--user',
        '10001:10001',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '-p',
        `127.0.0.1:${hostPort}:8000`,
        '-e',
        TOKEN_NAME,
        image,
      ],
      { env: { ...process.env, [TOKEN_NAME]: token } },
    );
    const inContainer = async (...args: readonly string[]): Promise<string> =>
      (await run('docker', ['exec', containerName, ...args])).stdout;
    return {
      baseUrl: `http://127.0.0.1:${hostPort}`,
      token,
      read: async () =>
        cgroupReading(
          await inContainer(
            'cat',
            `${CGROUP}/memory.current`,
            `${CGROUP}/memory.stat`,
          ),
        ),
      recordedPeakMib: async () => {
        const text = await inContainer('cat', `${CGROUP}/memory.peak`);
        const bytes = Number(text);
        if (text.trim() === '' || !Number.isFinite(bytes)) {
          throw new Error(`not a cgroup v2 memory.peak reading: ${text}`);
        }
        return toMib(bytes);
      },
      logs: async () => {
        const { stdout, stderr } = await run(
          'docker',
          ['logs', containerName],
          {
            maxBuffer: 64 * MIB,
          },
        );
        return stdout + stderr;
      },
      stop: async () => {
        await run('docker', ['rm', '-f', containerName]);
      },
    };
  },
});

const rssMibOf = (pid: number): number => {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    return Number(/VmRSS:\s+(\d+) kB/.exec(status)?.[1] ?? 0) / 1024;
  } catch {
    // The process ended between the listing and the read.
    return 0;
  }
};

const childrenOf = (pid: number): readonly number[] => {
  try {
    return readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
      .split(' ')
      .filter((text) => text !== '')
      .map(Number);
  } catch {
    return [];
  }
};

const MAIN = fileURLToPath(new URL('../../../dist/main.js', import.meta.url));

/** `node dist/main.js` on this machine, at its fixed port 8000. */
export const localTarget = (): Target => ({
  where: `OUTSIDE the image (a stand-in, not the image's numbers): node ${process.version} on Linux ${release()}, the RSS of the service process plus its children, not a cgroup reading`,
  start: () => {
    const token = randomBytes(16).toString('hex');
    const logs: Buffer[] = [];
    const child = spawn(process.execPath, [MAIN], {
      env: {
        PATH: process.env.PATH ?? '',
        RAYON_NUM_THREADS: '1',
        [TOKEN_NAME]: token,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', (data: Buffer) => logs.push(data));
    const pid = child.pid;
    if (pid === undefined) {
      return Promise.reject(new Error('node dist/main.js did not start'));
    }
    return Promise.resolve({
      baseUrl: 'http://127.0.0.1:8000',
      token,
      read: async () => ({
        totalMib: Math.ceil(
          [pid, ...childrenOf(pid)].reduce((sum, p) => sum + rssMibOf(p), 0),
        ),
        workingSetMib: null,
      }),
      recordedPeakMib: async () => null,
      logs: async () => Buffer.concat(logs).toString('utf8'),
      stop: () =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once('exit', () => resolve());
          child.kill('SIGTERM');
        }),
    });
  },
});
