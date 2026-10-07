import { Transform } from 'stream';

export const convertStreamToBuffer = (stream: any): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const buffer: Uint8Array[] = [];

    stream.on('data', (chunk: Uint8Array) => {
      buffer.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(buffer)));
    stream.on('error', (err) => reject(err));
  });
};

export const getBufferToFixedSizeTransform = (size: number): Transform => {
  let buffer = Buffer.alloc(size);
  let filledBufferSize = 0;

  return new Transform({
    transform(chunk: Buffer, encoding, callback) {
      let offset = 0;
      while (offset < chunk.length) {
        // The data size to add to buffer.
        // - If the remaining chunk size is smaller than the remaining buffer size:
        //     - Add all of the remaining chunk to buffer => dataSize is the remaining chunk size
        // - If the remaining chunk size is larger than the remaining buffer size:
        //     - Fill the buffer, and upload => dataSize is the remaining buffer size
        //     - The remaining chunk after upload will be added to buffer in the next iteration
        const dataSize = Math.min(
          size - filledBufferSize,
          chunk.length - offset,
        );
        // Add chunk data to buffer
        chunk.copy(buffer, filledBufferSize, offset, offset + dataSize);
        filledBufferSize += dataSize;

        // When buffer reaches size, push to next stream
        if (filledBufferSize === size) {
          this.push(buffer);
          // Reset buffer after push
          buffer = Buffer.alloc(size);
          filledBufferSize = 0;
        }

        offset += dataSize;
      }
      callback();
    },
    flush(callback) {
      // push the final buffer
      if (filledBufferSize > 0) {
        this.push(buffer.slice(0, filledBufferSize));
      }
      callback();
    },
  });
};
