import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { openFdCount } from '../runner/spec-support';
import { postFile, recordOf } from './spec-support/extract-client';
import { fakeRunner, holdingRunner } from './spec-support/fake-runner';
import {
  bodyTail,
  fileHead,
  multipartContentType,
} from './spec-support/multipart';
import {
  openConnection,
  type RawConnection,
  type RequestHeadOptions,
  requestHead,
} from './spec-support/raw-http';
import { type TestService, useTestService } from './spec-support/test-service';

// Answers the HTTP layer gives before reading the whole body (401, 413, 422,
// 408, 503) on connections Node closes after answering (HTTP/1.0 without
// keep-alive, `Connection: close`). research.md 16.5 / 16.9 (e)-(g): the answer
// must reach the client every time, and a client that never sends FIN must
// not keep the server's socket (and its fd) open.

vi.setConfig({ testTimeout: 60_000 });

let runner = fakeRunner();
const service = useTestService(() => {
  runner = fakeRunner();
  return { runner };
});
const MIB = 1024 * 1024;
const REPEAT = 30;
const REPEAT_CLIENT = fileURLToPath(
  new URL('./spec-support/repeat-upload-client.mjs', import.meta.url),
);
const run = promisify(execFile);

const declaredUpload = (
  target: TestService,
  head: RequestHeadOptions,
  fileBytes: number,
): Buffer => {
  const file = fileHead('a.txt');
  return Buffer.concat([
    requestHead({
      token: target.token,
      contentType: multipartContentType(),
      contentLength: file.length + fileBytes + bodyTail().length,
      ...head,
    }),
    file,
    Buffer.alloc(fileBytes, 0x78),
    bodyTail(),
  ]);
};

/** Sends `bytes` in 64 KiB writes, as a client streaming a file does, and reads the answer. */
const answerOnce = async (target: TestService, bytes: Buffer) => {
  const connection = await openConnection(target.address);
  try {
    for (let at = 0; at < bytes.length; at += 64 * 1024) {
      if (!(await connection.send(bytes.subarray(at, at + 64 * 1024)))) break;
    }
    return await connection.response(10_000);
  } finally {
    connection.destroy();
  }
};

/** Runs repeat-upload-client.mjs in its own process and returns the answers it got. */
const answersFromAnotherProcess = async (
  target: TestService,
  mode: 'http10' | 'close' | 'chunked-close',
  count: number,
  fileBytes: number,
): Promise<readonly { status: number | null; connection: string | null }[]> => {
  const { stdout } = await run(process.execPath, [
    REPEAT_CLIENT,
    String(target.address.port),
    target.token,
    mode,
    String(count),
    String(fileBytes),
  ]);
  const answers: unknown = recordOf(JSON.parse(stdout)).answers;
  if (!Array.isArray(answers)) throw new Error(`no answers: ${stdout}`);
  return answers.map((answer) => {
    const { status, connection } = recordOf(answer);
    return {
      status: typeof status === 'number' ? status : null,
      connection: typeof connection === 'string' ? connection : null,
    };
  });
};

// The client runs in another process: in the server's own process the answer
// is read before the reset that loses it, so a server that stops draining
// (research.md 16.5, option 0) would still pass.
describe('a 413 reaches a client whose connection closes after the answer', () => {
  it.each([
    ['HTTP/1.0', 'http10'],
    ['Connection: close', 'close'],
  ] as const)(`%s, declared over the cap, ${REPEAT} times`, async (_case, mode) => {
    const target = await service.restart(runner, { MAX_FILE_SIZE_MB: '1' });

    const answers = await answersFromAnotherProcess(
      target,
      mode,
      REPEAT,
      2 * MIB,
    );

    expect(answers).toEqual(
      Array(REPEAT).fill({ status: 413, connection: 'close' }),
    );
  });

  it(`chunked with Connection: close, over the cap mid-body, ${REPEAT} times`, async () => {
    const target = await service.restart(runner, { MAX_FILE_SIZE_MB: '1' });

    const answers = await answersFromAnotherProcess(
      target,
      'chunked-close',
      REPEAT,
      4 * MIB,
    );

    expect(answers.map((answer) => answer.status)).toEqual(
      Array(REPEAT).fill(413),
    );
  });

  it('a keep-alive client gets `Connection: keep-alive` on its 413', async () => {
    const target = await service.restart(runner, { MAX_FILE_SIZE_MB: '1' });

    const answer = await answerOnce(
      target,
      declaredUpload(target, {}, 2 * MIB),
    );

    expect(answer?.status).toBe(413);
    expect(answer?.headers.connection?.toLowerCase()).not.toBe('close');
  });
});

// Each kind: what to send and the status it gets, on a connection Node closes after answering.
type Kind = readonly [
  name: string,
  status: number,
  build: (target: TestService) => Buffer,
];
const KINDS: readonly Kind[] = [
  [
    '401, Connection: close',
    401,
    (t) => declaredUpload({ ...t, token: 'wrong' }, { close: true }, 10),
  ],
  [
    '401, HTTP/1.0',
    401,
    (t) => declaredUpload({ ...t, token: 'wrong' }, { version: '1.0' }, 10),
  ],
  [
    '413 declared, HTTP/1.0, 2 MB sent',
    413,
    (t) => declaredUpload(t, { version: '1.0' }, 2 * MIB),
  ],
  [
    '413 declared, Connection: close, 2 MB sent',
    413,
    (t) => declaredUpload(t, { close: true }, 2 * MIB),
  ],
  [
    '413 declared with Expect: 100-continue',
    413,
    (t) =>
      declaredUpload(
        t,
        { close: true, extra: ['Expect: 100-continue'] },
        2 * MIB,
      ),
  ],
  [
    '422 invalid body, Connection: close',
    422,
    (t) =>
      Buffer.concat([
        requestHead({
          token: t.token,
          contentType: 'application/json',
          contentLength: 2,
          close: true,
        }),
        Buffer.from('{}'),
      ]),
  ],
  [
    '408 stalled body, Connection: close',
    408,
    (t) => declaredUpload(t, { close: true }, 10).subarray(0, 300),
  ],
];

/** Opens `count` clients that never send FIN, sends each the request and waits for every answer. */
const finlessClients = async (
  target: TestService,
  bytes: Buffer,
  count: number,
): Promise<{ clients: RawConnection[]; statuses: (number | undefined)[] }> => {
  const clients = await Promise.all(
    Array.from({ length: count }, () =>
      openConnection(target.address, { allowHalfOpen: true }),
    ),
  );
  const statuses = await Promise.all(
    clients.map(async (client) => {
      await client.send(bytes);
      return (await client.response(10_000))?.status;
    }),
  );
  return { clients, statuses };
};

// Counts this process's open files through /proc.
describe.skipIf(process.platform !== 'linux')(
  'a client that never sends FIN does not keep the server socket (16.9 (g))',
  () => {
    const COUNT = 10;

    it.each(KINDS)('%s', async (_name, status, build) => {
      // Enough slots that the stalled bodies all wait for the deadline at once.
      const target = await service.restart(runner, {
        MAX_FILE_SIZE_MB: '1',
        UPLOAD_TIMEOUT_S: '1',
        MAX_CONCURRENCY: String(COUNT),
      });
      const before = openFdCount();

      const { clients, statuses } = await finlessClients(
        target,
        build(target),
        COUNT,
      );
      try {
        expect(statuses).toEqual(Array(COUNT).fill(status));
        // Our COUNT client sockets stay open; the server's COUNT must go.
        await expect
          .poll(() => openFdCount() - before, { timeout: 3_000 })
          .toBeLessThanOrEqual(COUNT + 2);
      } finally {
        for (const client of clients) client.destroy();
      }
    });

    it('503 while every slot is busy', async () => {
      const held = holdingRunner();
      const target = await service.restart(held.runner, {
        MAX_CONCURRENCY: '1',
      });
      const first = postFile(target.url, 'a.txt', 'slow', {
        token: target.token,
      });
      await held.started;
      const before = openFdCount();

      const { clients, statuses } = await finlessClients(
        target,
        declaredUpload(target, { close: true }, 10),
        COUNT,
      );
      try {
        expect(statuses).toEqual(Array(COUNT).fill(503));
        await expect
          .poll(() => openFdCount() - before, { timeout: 3_000 })
          .toBeLessThanOrEqual(COUNT + 2);
      } finally {
        for (const client of clients) client.destroy();
        held.release();
        await first;
      }
    });
  },
);
