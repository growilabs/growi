import { Transform } from 'node:stream';

export function createBatchStream<T>(batchSize: number): Transform {
  let batchBuffer: T[] = [];

  return new Transform({
    // object mode
    objectMode: true,

    transform(doc: T, _encoding, callback) {
      batchBuffer.push(doc);

      if (batchBuffer.length >= batchSize) {
        this.push(batchBuffer);

        // reset buffer
        batchBuffer = [];
      }

      callback();
    },

    final(callback) {
      if (batchBuffer.length > 0) {
        this.push(batchBuffer);
      }
      callback();
    },
  });
}
