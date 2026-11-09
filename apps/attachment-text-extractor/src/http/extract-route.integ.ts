import type { FailureKind } from '../contract';
import {
  errorOf,
  extractedOf,
  jsonOf,
  postFile,
} from './spec-support/extract-client';
import {
  DETAIL_THAT_MUST_NOT_LEAK,
  failed,
  fakeRunner,
  forwardedBytes,
  holdingRunner,
  succeeded,
} from './spec-support/fake-runner';
import { useTestService } from './spec-support/test-service';

// POST /extract with a stand-in runner: what reaches the runner, how its
// outcome becomes the answer (Req 1.3), the slot (Req 3.2) and the size limit
// (Req 3.3). Python test_extract_router.py (success, mapping, slot release,
// intake limits) and test_client_disconnect.py (the abort signal; Req 3.5).

let runner = fakeRunner();
const service = useTestService(() => {
  runner = fakeRunner();
  return { runner };
});
const MIB = 1024 * 1024;

const post = (
  fileName = 'a.txt',
  data: Uint8Array | string = 'payload',
  mimeType?: string,
) => {
  const { url, token } = service.current();
  return postFile(url, fileName, data, { token, mimeType });
};

describe('a successful conversion', () => {
  it('answers pages, mimeType and extractedCharacters, and forwards the upload', async () => {
    const answer = await post('a.txt', 'payload', 'text/plain');

    expect(answer.status).toBe(200);
    expect(jsonOf(answer)).toEqual({
      pages: [{ pageNumber: 1, label: '1', content: 'hello' }],
      mimeType: 'text/plain',
      extractedCharacters: 5,
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    const [input] = runner.run.mock.calls[0] ?? [];
    if (input === undefined) throw new Error('the runner got no input');
    expect(forwardedBytes(input).toString()).toBe('payload');
    expect(input.fileName).toBe('a.txt');
    expect(input.mimeHint).toBe('text/plain');
  });

  it('sums extractedCharacters over every page', async () => {
    runner.run.mockResolvedValue(
      succeeded(
        [
          { pageNumber: 1, label: '1', content: 'abc' },
          { pageNumber: 2, label: '2', content: 'de' },
        ],
        { mimeType: 'application/pdf' },
      ),
    );

    expect(extractedOf(await post()).extractedCharacters).toBe(5);
  });

  it('counts code points: a surrogate pair is one character (17.10)', async () => {
    runner.run.mockResolvedValue(
      succeeded([{ pageNumber: null, label: null, content: '𠮷😀ab' }]),
    );

    expect(extractedOf(await post()).extractedCharacters).toBe(4);
  });

  it('returns non-ASCII content as UTF-8 JSON', async () => {
    runner.run.mockResolvedValue(
      succeeded([{ pageNumber: 1, label: '1', content: '日本語の本文 🎉' }]),
    );

    const answer = await post();

    expect(answer.headers.get('content-type')).toMatch(/^application\/json/);
    expect(extractedOf(answer).pages[0]?.content).toBe('日本語の本文 🎉');
  });

  it('passes an empty mimeType field as no hint', async () => {
    await post('a.txt', 'payload', '');

    expect(runner.run.mock.calls[0]?.[0].mimeHint).toBeNull();
  });

  it('passes no hint when the mimeType field is absent', async () => {
    await post('a.txt', 'payload');

    expect(runner.run.mock.calls[0]?.[0].mimeHint).toBeNull();
  });
});

// The error table of the target spec (design.md §Error Handling), written out
// here so a changed row in error-table.ts fails this test.
const EXPECTED: Readonly<Record<FailureKind, readonly [number, string]>> = {
  unsupported: [400, 'unsupported_format'],
  encrypted: [422, 'file_encrypted'],
  malformed: [422, 'extraction_failed'],
  limit_exceeded: [422, 'resource_limit_exceeded'],
  memory_exceeded: [422, 'resource_limit_exceeded'],
  result_too_large: [422, 'resource_limit_exceeded'],
  timeout: [408, 'extraction_timeout'],
  crashed: [500, 'extraction_failed'],
  internal: [500, 'extraction_failed'],
};

describe('a failed conversion', () => {
  it.each(
    Object.entries(EXPECTED),
  )('%s gives %j, without the detail', async (kind, [status, code]) => {
    const failure = Object.keys(EXPECTED).find(
      (k): k is FailureKind => k === kind,
    );
    if (failure === undefined) throw new Error(kind);
    runner.run.mockResolvedValue(failed(failure));

    const answer = await post();

    expect(answer.status).toBe(status);
    expect(errorOf(answer).code).toBe(code);
    expect(errorOf(answer).message.split(':', 1)[0]).toBe(kind);
    expect(errorOf(answer).keys).toEqual(['code', 'message']);
    expect(answer.text).not.toContain(DETAIL_THAT_MUST_NOT_LEAK);
  });

  it('a runner that throws is a 500 internal, and the error text stays out', async () => {
    runner.run.mockRejectedValue(new Error('/srv/secret/path exploded'));

    const answer = await post();

    expect(answer.status).toBe(500);
    expect(errorOf(answer)).toMatchObject({ code: 'extraction_failed' });
    expect(errorOf(answer).message.split(':', 1)[0]).toBe('internal');
    expect(answer.text).not.toContain('/srv/secret/path');
  });
});

describe('the concurrency slot (MAX_CONCURRENCY=1)', () => {
  const oneSlot = { MAX_CONCURRENCY: '1', MAX_FILE_SIZE_MB: '1' };

  it.each([
    'timeout',
    'crashed',
  ] as const)('comes back after a %s', async (kind) => {
    const { url, token } = await service.restart(runner, oneSlot);
    runner.run.mockResolvedValueOnce(failed(kind));

    expect(
      (await postFile(url, 'a.txt', 'x', { token })).status,
    ).toBeGreaterThanOrEqual(408);
    expect((await postFile(url, 'a.txt', 'x', { token })).status).toBe(200);
  });

  it('comes back after the runner throws', async () => {
    const { url, token } = await service.restart(runner, oneSlot);
    runner.run.mockRejectedValueOnce(new Error('boom'));

    expect((await postFile(url, 'a.txt', 'x', { token })).status).toBe(500);
    expect((await postFile(url, 'a.txt', 'x', { token })).status).toBe(200);
  });

  it('is busy (503 service_busy) while a conversion runs, without calling the runner again', async () => {
    const held = holdingRunner();
    const { url, token } = await service.restart(held.runner, oneSlot);
    const first = postFile(url, 'a.txt', 'slow', { token });
    await held.started;

    const second = await postFile(url, 'a.txt', 'probe', { token });

    expect(second.status).toBe(503);
    expect(errorOf(second).code).toBe('service_busy');
    expect(held.runner.run).toHaveBeenCalledTimes(1);
    held.release();
    expect((await first).status).toBe(200);
    expect((await postFile(url, 'a.txt', 'after', { token })).status).toBe(200);
  });
});

describe('the file size limit (MAX_FILE_SIZE_MB=1)', () => {
  it('a file one byte over is 413 file_too_large and never reaches the runner', async () => {
    const { url, token } = await service.restart(runner, {
      MAX_FILE_SIZE_MB: '1',
    });

    const answer = await postFile(url, 'a.txt', Buffer.alloc(MIB + 1, 0x78), {
      token,
    });

    expect(answer.status).toBe(413);
    expect(errorOf(answer).code).toBe('file_too_large');
    expect(errorOf(answer).message).toContain('1 MiB');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('a file of exactly the limit reaches the runner whole', async () => {
    const { url, token } = await service.restart(runner, {
      MAX_FILE_SIZE_MB: '1',
    });

    expect(
      (await postFile(url, 'a.txt', Buffer.alloc(MIB, 0x78), { token })).status,
    ).toBe(200);
    const input = runner.run.mock.calls[0]?.[0];
    if (input === undefined) throw new Error('the runner got no input');
    expect(forwardedBytes(input)).toEqual(Buffer.alloc(MIB, 0x78));
  });
});

describe('a caller that goes away (Req 3.5)', () => {
  it('aborts the run, and the slot comes back only after the run has ended', async () => {
    const held = holdingRunner({ endOnAbort: false });
    const { url, token } = await service.restart(held.runner, {
      MAX_CONCURRENCY: '1',
    });
    const caller = new AbortController();
    const leaving = postFile(url, 'a.txt', 'slow', {
      token,
      signal: caller.signal,
    }).catch(() => null);
    const { signal } = await held.started;

    caller.abort();
    await held.aborted;
    await leaving;

    expect(signal.aborted).toBe(true);
    // The run is still cleaning up: its slot is not free yet.
    expect((await postFile(url, 'a.txt', 'probe', { token })).status).toBe(503);
    held.release();
    await held.finished;
    await expect
      .poll(
        async () => (await postFile(url, 'a.txt', 'after', { token })).status,
        { timeout: 3_000 },
      )
      .toBe(200);
  });

  it('a caller that waits gets the result', async () => {
    const held = holdingRunner();
    const { url, token } = await service.restart(held.runner);
    const waiting = postFile(url, 'a.txt', 'slow', { token });
    const { signal } = await held.started;

    expect(signal.aborted).toBe(false);
    held.release(
      succeeded([{ pageNumber: null, label: null, content: 'done' }]),
    );

    expect(extractedOf(await waiting).pages[0]?.content).toBe('done');
  });
});
