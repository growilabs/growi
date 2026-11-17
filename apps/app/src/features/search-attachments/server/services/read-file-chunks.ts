export class FileReadTimeoutError extends Error {
  constructor(ms: number) {
    super(`Reading the stored file took longer than ${ms}ms`);
    this.name = 'FileReadTimeoutError';
  }
}

const destroy = (stream: NodeJS.ReadableStream): void => {
  (stream as Partial<{ destroy: () => void }>).destroy?.();
};

/**
 * Collects the chunks of a readable stream. They are not joined: the request
 * body copies them once, and a joined Buffer would be a second copy.
 */
async function streamToChunks(
  stream: NodeJS.ReadableStream,
): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return chunks;
}

/**
 * Opens and reads a stored file, giving up after `timeoutMs`: the caller
 * holds an extraction slot meanwhile, and storage that hangs would hold it
 * forever. On expiry the stream is destroyed (also one that opens later)
 * and FileReadTimeoutError is thrown.
 */
export const readFileChunks = async (
  open: () => Promise<NodeJS.ReadableStream>,
  timeoutMs: number,
): Promise<Buffer[]> => {
  let expired = false;
  let stream: NodeJS.ReadableStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reading = (async () => {
    stream = await open();
    if (expired) {
      destroy(stream);
    }
    return streamToChunks(stream);
  })();
  // A read that settles after the expiry has no one waiting for it
  reading.catch(() => {});

  try {
    return await Promise.race([
      reading,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          if (stream != null) destroy(stream);
          reject(new FileReadTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
