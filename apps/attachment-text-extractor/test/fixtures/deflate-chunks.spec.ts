import { finished } from 'node:stream/promises';
import { crc32, createInflateRaw, inflateRawSync } from 'node:zlib';

import { deflateChunks } from './deflate-chunks';

describe('deflateChunks', () => {
  it('produces one raw deflate stream that inflates to the chunks joined in order', () => {
    const chunks = [
      Buffer.from('first chunk '),
      Buffer.from('second '.repeat(1000)),
      Buffer.alloc(0),
      Buffer.from('last'),
    ];
    const joined = Buffer.concat(chunks);

    const deflated = deflateChunks(chunks);

    expect(inflateRawSync(deflated.body)).toEqual(joined);
    expect(deflated.uncompressedSize).toBe(joined.length);
    expect(deflated.crc32).toBe(crc32(joined));
  });

  it('keeps the body small when the same large chunk repeats, without holding the whole input', async () => {
    const mib = 1024 * 1024;
    const chunk = Buffer.alloc(mib);
    const repeats = function* () {
      for (let i = 0; i < 64; i++) {
        yield chunk;
      }
    };

    const deflated = deflateChunks(repeats());

    expect(deflated.uncompressedSize).toBe(64 * mib);
    expect(deflated.body.length).toBeLessThan(mib);
    // Count the inflated bytes as they stream, never holding 64 MiB at once.
    const inflater = createInflateRaw();
    let inflatedSize = 0;
    inflater.on('data', (data: Buffer) => {
      inflatedSize += data.length;
    });
    // finished() also rejects on a stream error, so a broken body fails fast.
    inflater.end(deflated.body);
    await finished(inflater);
    expect(inflatedSize).toBe(64 * mib);
  });
});
