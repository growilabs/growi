import { pipeline, Readable, Writable } from 'stream';
import { promisify } from 'util';

import { getBufferToFixedSizeTransform } from './stream';

const pipelinePromise = promisify(pipeline);

describe('stream util', () => {
  describe('getBufferToFixedSizeTransform', () => {
    it('should buffer data to fixed size and push to next stream', async () => {
      const bufferSize = 10;
      const chunks: Buffer[] = [];

      const readable = Readable.from([
        Buffer.from('1234567890A'),
        Buffer.from('BCDE'),
        Buffer.from('FGH'),
        Buffer.from('IJKL'),
      ]);
      const transform = getBufferToFixedSizeTransform(bufferSize);
      const writable = new Writable({
        write(chunk: Buffer, encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });

      const expectedChunks = [
        Buffer.from('1234567890'),
        Buffer.from('ABCDEFGHIJ'),
        Buffer.from('KL'),
      ];

      await pipelinePromise(readable, transform, writable);

      expect(chunks).toHaveLength(expectedChunks.length);
      expectedChunks.forEach((expectedChunk, index) => {
        expect(chunks[index].toString()).toBe(expectedChunk.toString());
      });
    });
  });
});
