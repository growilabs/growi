import { readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { errorOf, extractedOf, postFile } from './spec-support/extract-client';
import {
  fakeRunner,
  forwardedBytes,
  holdingRunner,
} from './spec-support/fake-runner';
import {
  bodyTail,
  fileHead,
  multipartContentType,
} from './spec-support/multipart';
import {
  chunk,
  openConnection,
  type RawConnection,
  requestHead,
} from './spec-support/raw-http';
import { type TestService, useTestService } from './spec-support/test-service';

// Receiving the body (Req 3.1-3.3): the order auth -> declared length -> slot
// -> capped, deadlined read; the cap counts the bytes that arrive. A real
// server on a free port, a stand-in runner. Python test_live_server.py
// TestIntakeOrder / TestUploadsDoNotUseTmpdir (the parse rows), test_limits.py
// (body cap) and test_integration_auth.py (401 before the slot).
// Req 3.3 (memory only, no temporary file): TMPDIR is shared with other test
// processes, so instead of comparing its listing, the test watches the files
// this process (the server) holds open under it while uploads are in flight.

let runner = fakeRunner();
const service = useTestService(() => {
  runner = fakeRunner();
  return { runner };
});
const MIB = 1024 * 1024;
const CAP_1MIB = MIB + 64 * 1024;

const restart = (env: Readonly<Record<string, string>>): Promise<TestService> =>
  service.restart(runner, env);

/** Opens a connection and sends the head of an upload declared as `declaredFileBytes`, then `sentFileBytes` of it. */
const openUpload = async (
  target: TestService,
  declaredFileBytes: number,
  sentFileBytes: number,
  token: string | null = target.token,
): Promise<RawConnection> => {
  const head = fileHead('a.txt');
  const connection = await openConnection(target.address);
  await connection.send(
    Buffer.concat([
      requestHead({
        token,
        contentType: multipartContentType(),
        contentLength: head.length + declaredFileBytes + bodyTail().length,
        close: true,
      }),
      head,
      Buffer.alloc(sentFileBytes, 0x78),
    ]),
  );
  return connection;
};

/** A chunked upload of `fileBytes` in 64 KiB pieces; stops writing once the server stops reading. */
const chunkedUpload = async (
  target: TestService,
  fileBytes: number,
  close: boolean,
) => {
  const connection = await openConnection(target.address);
  try {
    await connection.send(
      requestHead({
        token: target.token,
        contentType: multipartContentType(),
        chunked: true,
        close,
      }),
    );
    await connection.send(chunk(fileHead('a.txt')));
    for (let sent = 0; sent < fileBytes; sent += 64 * 1024) {
      if (
        !(await connection.send(
          chunk(Buffer.alloc(Math.min(64 * 1024, fileBytes - sent), 0x78)),
        ))
      )
        break;
    }
    await connection.send(
      Buffer.concat([chunk(bodyTail()), chunk(Buffer.alloc(0))]),
    );
    return await connection.response(10_000);
  } finally {
    connection.destroy();
  }
};

const smallRequestWorks = async (target: TestService): Promise<void> => {
  expect(
    (
      await postFile(target.url, 'ok.txt', 'still serving', {
        token: target.token,
      })
    ).status,
  ).toBe(200);
};

describe('the declared Content-Length', () => {
  it('over the cap is 413 file_too_large without the body, and takes no slot', async () => {
    const target = await restart({
      MAX_FILE_SIZE_MB: '1',
      MAX_CONCURRENCY: '1',
    });
    const connection = await openUpload(target, 10 * 1024 * MIB, 0);

    const answer = await connection.response(5_000);
    connection.destroy();

    expect(answer?.status).toBe(413);
    expect(answer?.text).toContain('"file_too_large"');
    expect(runner.run).not.toHaveBeenCalled();
    await smallRequestWorks(target);
  });

  it('is checked against the file limit plus 64 KiB of framing', async () => {
    const target = await restart({
      MAX_FILE_SIZE_MB: '1',
      UPLOAD_TIMEOUT_S: '1',
    });
    const send = async (contentLength: number) => {
      const connection = await openConnection(target.address);
      await connection.send(
        requestHead({
          token: target.token,
          contentType: multipartContentType(),
          contentLength,
          close: true,
        }),
      );
      const answer = await connection.response(5_000);
      connection.destroy();
      return answer?.status;
    };

    // One byte over the cap: refused at once. At the cap: read, so the
    // missing body runs into the upload deadline instead.
    expect(await send(CAP_1MIB + 1)).toBe(413);
    expect(await send(CAP_1MIB)).toBe(408);
  });
});

describe('a body without Content-Length (chunked)', () => {
  it.each([
    ['keep-alive', false],
    ['Connection: close', true],
  ])('over the cap is 413 while it streams in (%s)', async (_case, close) => {
    const target = await restart({
      MAX_FILE_SIZE_MB: '1',
      MAX_CONCURRENCY: '1',
    });

    const answer = await chunkedUpload(target, 20 * MIB, close);

    expect(answer?.status).toBe(413);
    expect(answer?.text).toContain('"file_too_large"');
    expect(runner.run).not.toHaveBeenCalled();
    await smallRequestWorks(target);
  });

  it('within the cap reaches the runner whole', async () => {
    const target = await restart({
      MAX_FILE_SIZE_MB: '1',
      MAX_CONCURRENCY: '1',
    });

    const answer = await chunkedUpload(target, 200 * 1024, true);

    expect(answer?.status).toBe(200);
    const input = runner.run.mock.calls[0]?.[0];
    if (input === undefined) throw new Error('the runner got no input');
    expect(forwardedBytes(input)).toEqual(Buffer.alloc(200 * 1024, 0x78));
  });
});

describe('the slot is taken before the body is read (Req 3.2)', () => {
  it('a second upload gets 503 at once while the first is still uploading, and the slot comes back', async () => {
    const target = await restart({
      MAX_CONCURRENCY: '1',
      UPLOAD_TIMEOUT_S: '20',
    });
    const holder = await openUpload(target, MIB, 1000);
    try {
      // Until the first upload holds the slot, a probe may still get it.
      let busy: Awaited<ReturnType<typeof postFile>> | undefined;
      let elapsed = Number.POSITIVE_INFINITY;
      const deadline = Date.now() + 10_000;
      while (busy?.status !== 503 && Date.now() < deadline) {
        const began = Date.now();
        busy = await postFile(target.url, 'a.txt', 'probe', {
          token: target.token,
        });
        elapsed = Date.now() - began;
      }

      expect(busy?.status).toBe(503);
      expect(busy === undefined ? '' : errorOf(busy).code).toBe('service_busy');
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      holder.destroy();
    }
    await expect
      .poll(
        async () =>
          (
            await postFile(target.url, 'a.txt', 'after', {
              token: target.token,
            })
          ).status,
        { timeout: 10_000 },
      )
      .toBe(200);
  });

  it('an unauthenticated upload is 401 and takes no slot', async () => {
    const target = await restart({ MAX_CONCURRENCY: '1' });

    const answer = await postFile(
      target.url,
      'a.txt',
      Buffer.alloc(MIB, 0x78),
      { token: null },
    );

    expect(answer.status).toBe(401);
    await smallRequestWorks(target);
  });
});

describe('the upload deadline (UPLOAD_TIMEOUT_S=1)', () => {
  it('cuts a stalled body with 408 extraction_timeout and frees the slot', async () => {
    const target = await restart({
      MAX_CONCURRENCY: '1',
      UPLOAD_TIMEOUT_S: '1',
    });
    const began = Date.now();
    const connection = await openUpload(target, MIB, 10);

    const answer = await connection.response(10_000);
    const elapsed = Date.now() - began;
    connection.destroy();

    expect(answer?.status).toBe(408);
    expect(answer?.text).toContain('"extraction_timeout"');
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(5_000);
    await smallRequestWorks(target);
  });

  it('covers the whole body, not each read: one byte every 200 ms is still cut', async () => {
    const target = await restart({
      MAX_CONCURRENCY: '1',
      UPLOAD_TIMEOUT_S: '1',
    });
    const began = Date.now();
    const connection = await openUpload(target, MIB, 0);
    const answer = connection.response(10_000);
    for (let i = 0; i < 25 && Date.now() - began < 5_000; i++) {
      await sleep(200);
      if (!(await connection.send(Buffer.from('x')))) break;
    }

    const received = await answer;
    connection.destroy();

    expect(received?.status).toBe(408);
    expect(Date.now() - began).toBeLessThan(5_000);
  });
});

describe('large uploads', () => {
  it('three concurrent 25 MiB uploads are never a parse error', async () => {
    const target = await restart({ MAX_CONCURRENCY: '3' });
    const data = Buffer.alloc(25 * MIB, 0x61);

    const answers = await Promise.all(
      [1, 2, 3].map(() =>
        postFile(target.url, 'a.txt', data, { token: target.token }),
      ),
    );

    for (const answer of answers) {
      expect([200, 503]).toContain(answer.status);
    }
    const converted = answers.filter((answer) => answer.status === 200).length;
    expect(converted).toBeGreaterThan(0);
    // Each conversion got the whole file.
    expect(
      runner.run.mock.calls.map(([input]) => forwardedBytes(input).length),
    ).toEqual(Array(converted).fill(25 * MIB));
    await smallRequestWorks(target);
  });

  it('a 70 MiB upload over the default limit is 413 and the service keeps serving', async () => {
    const target = await restart({});

    const answer = await postFile(
      target.url,
      'big.txt',
      Buffer.alloc(70 * MIB, 0x78),
      { token: target.token },
    );

    expect(answer.status).toBe(413);
    expect(errorOf(answer).code).toBe('file_too_large');
    expect(runner.run).not.toHaveBeenCalled();
    await smallRequestWorks(target);
    expect(
      extractedOf(
        await postFile(target.url, 'a.txt', 'x', { token: target.token }),
      ).pages,
    ).toHaveLength(1);
  });
});

/** Regular files under TMPDIR this process holds open (/proc/self/fd). */
const openTempFiles = (): Set<string> => {
  const root = `${realpathSync(tmpdir())}/`;
  const found = new Set<string>();
  for (const fd of readdirSync('/proc/self/fd')) {
    try {
      const target = readlinkSync(`/proc/self/fd/${fd}`);
      if (target.startsWith(root) && statSync(target).isFile())
        found.add(target);
    } catch {
      // the fd closed meanwhile
    }
  }
  return found;
};

/** Every temp file opened (and not open before) at any sample over `ms`. */
const tempFilesOpenedDuring = async (
  before: Set<string>,
  ms: number,
): Promise<string[]> => {
  const seen = new Set<string>();
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const file of openTempFiles()) {
      if (!before.has(file)) seen.add(file);
    }
    await sleep(20);
  }
  return [...seen];
};

describe.skipIf(process.platform !== 'linux')(
  'uploads stay in memory (Req 3.3)',
  () => {
    it('three concurrent 25 MiB uploads open no temporary file, mid-body or mid-conversion', async () => {
      const held = holdingRunner();
      const target = await service.restart(held.runner, {
        MAX_CONCURRENCY: '3',
      });
      const before = openTempFiles();
      const uploads = await Promise.all(
        [1, 2, 3].map(() => openUpload(target, 25 * MIB, 20 * MIB)),
      );
      try {
        // Mid-body: 20 of the 25 MiB have arrived.
        expect(await tempFilesOpenedDuring(before, 500)).toEqual([]);

        for (const upload of uploads) {
          await upload.send(
            Buffer.concat([Buffer.alloc(5 * MIB, 0x78), bodyTail()]),
          );
        }
        // Mid-conversion: the first run holds its whole file.
        const { input } = await held.started;
        expect(forwardedBytes(input).length).toBe(25 * MIB);
        expect(await tempFilesOpenedDuring(before, 500)).toEqual([]);
      } finally {
        held.release();
        for (const upload of uploads) upload.destroy();
      }
    });
  },
);
