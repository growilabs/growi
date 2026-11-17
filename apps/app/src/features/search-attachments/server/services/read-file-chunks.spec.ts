import { Readable } from 'node:stream';

import { FileReadTimeoutError, readFileChunks } from './read-file-chunks';

const stalledStream = () => new Readable({ read() {} });

describe('readFileChunks', () => {
  it('returns the chunks of a stream that ends in time', async () => {
    const chunks = await readFileChunks(
      async () => Readable.from([Buffer.from('ab'), Buffer.from('c')]),
      { timeoutMs: 1000 },
    );

    expect(Buffer.concat(chunks).toString()).toBe('abc');
  });

  it('destroys a stream that the storage hands over only after the time limit', async () => {
    let handOver: (s: Readable) => void = () => {};
    const late = stalledStream();

    await expect(
      readFileChunks(
        () =>
          new Promise<Readable>((resolve) => {
            handOver = resolve;
          }),
        { timeoutMs: 20 },
      ),
    ).rejects.toBeInstanceOf(FileReadTimeoutError);
    handOver(late);
    await new Promise(setImmediate);

    expect(late.destroyed).toBe(true);
  });

  it('stops reading and destroys the stream as soon as the caller aborts', async () => {
    const stream = stalledStream();
    const caller = new AbortController();

    const reading = readFileChunks(async () => stream, {
      timeoutMs: 60_000,
      signal: caller.signal,
    });
    await new Promise(setImmediate);
    caller.abort();

    await expect(reading).rejects.toThrow();
    expect(stream.destroyed).toBe(true);
  });
});
