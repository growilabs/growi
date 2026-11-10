import { PassThrough } from 'node:stream';

import { readFrame, writeFrame } from './length-prefixed-json';

// A frame body may be written as the pieces it arrived in (the upload's
// chunks, research.md 16.9): the reader sees one frame whose length is their
// total and whose bytes are theirs in order, the same as one joined body.

const MAX = 1024 * 1024;

const written = async (
  body: Uint8Array | readonly Uint8Array[],
): Promise<Buffer> => {
  const stream = new PassThrough();
  const read = readFrame(stream, MAX);
  await writeFrame(stream, body);
  return read;
};

describe('writeFrame with pieces', () => {
  it('reads back as one frame of the pieces joined in order', async () => {
    const pieces = [
      Buffer.from('first,'),
      Buffer.from('日本語,'),
      Buffer.from('last'),
    ];

    expect(await written(pieces)).toEqual(Buffer.concat(pieces));
  });

  it('writes the same bytes as the joined body, the length header included', async () => {
    const pieces = [
      Buffer.alloc(70_000, 0x61),
      Buffer.from(''),
      Buffer.alloc(3, 0x62),
    ];
    const sent = (body: Uint8Array | readonly Uint8Array[]) => {
      const stream = new PassThrough();
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      return writeFrame(stream, body).then(() => Buffer.concat(chunks));
    };

    expect(await sent(pieces)).toEqual(await sent(Buffer.concat(pieces)));
  });

  it('leaves the next frame readable after a frame written in pieces', async () => {
    const stream = new PassThrough();
    const first = readFrame(stream, MAX);
    await writeFrame(stream, [Buffer.from('ab'), Buffer.from('cd')]);
    await writeFrame(stream, Buffer.from('next'));

    expect((await first).toString()).toBe('abcd');
    expect((await readFrame(stream, MAX)).toString()).toBe('next');
  });

  it('an empty list of pieces is an empty frame', async () => {
    expect(await written([])).toEqual(Buffer.alloc(0));
  });
});
