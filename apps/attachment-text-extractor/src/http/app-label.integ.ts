import { fakeRunner, holdingRunner } from './spec-support/fake-runner';
import {
  bodyTail,
  fileHead,
  multipartContentType,
} from './spec-support/multipart';
import {
  openConnection,
  type RawResponse,
  requestHead,
  sendRaw,
} from './spec-support/raw-http';
import { type TestService, useTestService } from './spec-support/test-service';

// The last field of the POST /extract line is app=<label>, taken from the
// optional X-Growi-App-Id request header. The label is for reading the log
// only: it never changes the answer, and a value that does not have the
// allowed shape is never written to the log.

const service = useTestService(() => ({ runner: fakeRunner() }));

const LABELED_VALUE = 'app-1.beta_2';
const REJECTED_MARKER = 'REJECTED-VALUE-MARKER';

const upload = (
  target: TestService,
  extra: readonly string[],
  fileBytes = 1,
): Buffer => {
  const file = fileHead('a.txt');
  return Buffer.concat([
    requestHead({
      token: target.token,
      contentType: multipartContentType(),
      contentLength: file.length + fileBytes + bodyTail().length,
      extra,
    }),
    file,
    Buffer.alloc(fileBytes, 0x78),
    bodyTail(),
  ]);
};

const requestLines = (target: TestService): string[] =>
  target.logs.filter((line) => line.includes(' extract format='));

const appOfLastLine = async (target: TestService): Promise<string> => {
  await expect.poll(() => requestLines(target).length).toBeGreaterThan(0);
  const match = /result=\S+ child_peak_rss_mb=\S+ app=(.*)$/.exec(
    requestLines(target).at(-1) ?? '',
  );
  if (match === null) throw new Error('app= is not the last field');
  return match[1] ?? '';
};

describe('app= on the request line', () => {
  it('is "-" when the header is absent', async () => {
    const target = service.current();
    await sendRaw(target.address, upload(target, []));

    expect(await appOfLastLine(target)).toBe('-');
  });

  it('is the value when it has the allowed shape', async () => {
    const target = service.current();
    await sendRaw(
      target.address,
      upload(target, [`X-Growi-App-Id: ${LABELED_VALUE}`]),
    );

    expect(await appOfLastLine(target)).toBe(LABELED_VALUE);
  });

  it.each([
    ['empty', ''],
    [
      '65 characters',
      `${REJECTED_MARKER}${'a'.repeat(65 - REJECTED_MARKER.length)}`,
    ],
    ['a space', `${REJECTED_MARKER} x`],
    ['a slash', `${REJECTED_MARKER}/x`],
    ['an equals sign', `${REJECTED_MARKER}=x`],
    ['a non-ASCII character', `${REJECTED_MARKER}é`],
  ])('is "(invalid)" for %s, and the value is not written', async (_name, value) => {
    const target = service.current();
    await sendRaw(target.address, upload(target, [`X-Growi-App-Id: ${value}`]));

    expect(await appOfLastLine(target)).toBe('(invalid)');
    expect(target.logs.join('\n')).not.toContain(REJECTED_MARKER);
  });

  it('is "(invalid)" for the same header twice, and neither value is written', async () => {
    const target = service.current();
    await sendRaw(
      target.address,
      upload(target, [
        `X-Growi-App-Id: ${REJECTED_MARKER}-1`,
        `X-Growi-App-Id: ${REJECTED_MARKER}-2`,
      ]),
    );

    expect(await appOfLastLine(target)).toBe('(invalid)');
    expect(target.logs.join('\n')).not.toContain(REJECTED_MARKER);
  });

  it('does not change the status or the body, whatever the value', async () => {
    const target = await service.restart(fakeRunner(), {
      MAX_CONCURRENCY: '5',
    });
    const headers = [
      [],
      [`X-Growi-App-Id: ${LABELED_VALUE}`],
      ['X-Growi-App-Id: bad value'],
      ['X-Growi-App-Id: a', 'X-Growi-App-Id: b'],
      ['X-Growi-App-Id: '],
    ];

    const answers = (
      await Promise.all(
        headers.map((extra) => sendRaw(target.address, upload(target, extra))),
      )
    ).filter((answer): answer is RawResponse => answer !== null);

    expect(answers).toHaveLength(headers.length);
    expect(new Set(answers.map((a) => a.status))).toEqual(new Set([200]));
    expect(new Set(answers.map((a) => a.text)).size).toBe(1);
  });

  it('leaves no line for a request that fails authentication, even with the header', async () => {
    const target = service.current();
    await sendRaw(
      target.address,
      upload({ ...target, token: 'wrong' }, [
        `X-Growi-App-Id: ${LABELED_VALUE}`,
      ]),
    );

    expect(requestLines(target)).toHaveLength(0);
  });
});

describe('app= on the lines written before the body is read', () => {
  const extra = [`X-Growi-App-Id: ${LABELED_VALUE}`];

  const expectLine = async (target: TestService, result: string) => {
    const pattern = new RegExp(`result=${result} .* app=${LABELED_VALUE}$`);
    await expect
      .poll(() => requestLines(target).some((line) => pattern.test(line)))
      .toBe(true);
  };

  it('service_busy', async () => {
    const held = holdingRunner();
    const target = await service.restart(held.runner, { MAX_CONCURRENCY: '1' });
    const first = sendRaw(target.address, upload(target, []));
    await held.started;

    const answer = await sendRaw(target.address, upload(target, extra));
    held.release();
    await first;

    expect(answer?.status).toBe(503);
    await expectLine(target, 'service_busy');
  });

  it('file_too_large, declared over the cap', async () => {
    const target = await service.restart(fakeRunner(), {
      MAX_FILE_SIZE_MB: '1',
    });
    const head = requestHead({
      token: target.token,
      contentType: multipartContentType(),
      contentLength: 2 * 1024 * 1024,
      close: true,
      extra,
    });

    const answer = await sendRaw(target.address, head);

    expect(answer?.status).toBe(413);
    await expectLine(target, 'file_too_large');
  });

  it('invalid_upload', async () => {
    const target = service.current();
    const body = Buffer.from('{}');
    const head = requestHead({
      token: target.token,
      contentType: 'application/json',
      contentLength: body.length,
      extra,
    });

    const answer = await sendRaw(target.address, Buffer.concat([head, body]));

    expect(answer?.status).toBe(422);
    await expectLine(target, 'invalid_upload');
  });

  it('upload_timeout, the body never completes', async () => {
    const target = await service.restart(fakeRunner(), {
      UPLOAD_TIMEOUT_S: '1',
    });
    const file = fileHead('a.txt');
    const head = requestHead({
      token: target.token,
      contentType: multipartContentType(),
      contentLength: file.length + 1000,
      extra,
    });
    const connection = await openConnection(target.address, {
      allowHalfOpen: true,
    });
    try {
      await connection.send(Buffer.concat([head, file]));

      const answer = await connection.response(3_000);

      expect(answer?.status).toBe(408);
      await expectLine(target, 'upload_timeout');
    } finally {
      connection.destroy();
    }
  });

  it('client_disconnected, the body ends early', async () => {
    const target = service.current();
    const file = fileHead('a.txt');
    const head = requestHead({
      token: target.token,
      contentType: multipartContentType(),
      contentLength: file.length + 1000,
      extra,
    });
    const connection = await openConnection(target.address);
    await connection.send(Buffer.concat([head, file]));
    connection.destroy();

    await expectLine(target, 'client_disconnected');
  });
});
