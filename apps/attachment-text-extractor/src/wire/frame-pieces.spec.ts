import { PassThrough } from 'node:stream';

import { writeFrame } from './length-prefixed-json';

// A frame body may be written as the pieces it arrived in (the upload's
// chunks, research.md 16.9): the reader sees one frame whose length is their
// total and whose bytes are theirs in order, the same as one joined body.

const sent = async (
  body: Uint8Array | readonly Uint8Array[],
): Promise<Buffer> => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  await writeFrame(stream, body);
  return Buffer.concat(chunks);
};

describe('writeFrame with pieces', () => {
  it('writes one frame of the pieces joined in order', async () => {
    const pieces = [
      Buffer.from('first,'),
      Buffer.from('日本語,'),
      Buffer.from('last'),
    ];
    const joined = Buffer.concat(pieces);

    expect(await sent(pieces)).toEqual(
      Buffer.concat([Buffer.from([0, 0, 0, joined.length]), joined]),
    );
  });

  it('writes the same bytes as the joined body, the length header included', async () => {
    const pieces = [
      Buffer.alloc(70_000, 0x61),
      Buffer.from(''),
      Buffer.alloc(3, 0x62),
    ];

    expect(await sent(pieces)).toEqual(await sent(Buffer.concat(pieces)));
  });

  it('an empty list of pieces is an empty frame', async () => {
    expect(await sent([])).toEqual(Buffer.from([0, 0, 0, 0]));
  });
});
