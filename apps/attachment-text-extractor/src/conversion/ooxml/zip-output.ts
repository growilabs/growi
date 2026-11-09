import { Readable } from 'node:stream';
import type { ZipFile } from 'yazl';

import { bufferChunk } from './zip-part-stream';

/** A yazl ZipFile whose every failure ends in one rejection, never an unhandled 'error' event. */
export interface ZipOutput {
  readonly zip: ZipFile;
  /** Records the first failure and stops the output. */
  fail(error: unknown): void;
  failed(): boolean;
  /** Ends the archive and reads it to the end, so late failures still have a listener. */
  finish(): Promise<Buffer>;
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('ZIP writer failed');

export const createZipOutput = (zip: ZipFile): ZipOutput => {
  const output = zip.outputStream;
  if (!(output instanceof Readable)) {
    throw new TypeError('yazl output is not a Readable');
  }
  let failure: Error | null = null;
  const fail = (error: unknown): void => {
    failure ??= toError(error);
    output.destroy(failure);
  };
  // Before the first entry is added: yazl emits a source's open error
  // synchronously from inside addReadStreamLazy.
  zip.on('error', fail);
  const finish = async (): Promise<Buffer> => {
    zip.end();
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of output) {
        chunks.push(bufferChunk(chunk));
      }
    } catch (error) {
      failure ??= toError(error);
    }
    if (failure != null) {
      throw failure;
    }
    return Buffer.concat(chunks);
  };
  return { zip, fail, failed: () => failure != null, finish };
};
