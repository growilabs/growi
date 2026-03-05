import { PassThrough } from 'stream';
import type { Entry } from 'unzip-stream';

export const tapStreamDataByPromise = (entry: Entry): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const buffers: Array<Buffer> = [];

    const entryContentGetterStream = new PassThrough()
      .on('data', (chunk) => {
        buffers.push(Buffer.from(chunk));
      })
      .on('end', () => {
        resolve(Buffer.concat(buffers));
      })
      .on('error', reject);

    entry.pipe(entryContentGetterStream).on('error', reject);
  });
};
