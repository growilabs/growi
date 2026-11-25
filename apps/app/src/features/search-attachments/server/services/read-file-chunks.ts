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
 * Opens and reads a stored file, giving up after `timeoutMs` or once
 * `signal` aborts: the caller holds an extraction slot meanwhile, and storage
 * that hangs would hold it forever. Giving up destroys the stream (also one
 * that opens later) and rejects.
 */
export const readFileChunks = async (
  open: () => Promise<NodeJS.ReadableStream>,
  { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<Buffer[]> => {
  let gaveUp = false;
  let stream: NodeJS.ReadableStream | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const reading = (async () => {
    stream = await open();
    if (gaveUp) {
      destroy(stream);
    }
    return streamToChunks(stream);
  })();
  // A read that settles after giving up has no one waiting for it
  reading.catch(() => {});

  const giveUp = new Promise<never>((_, reject) => {
    const stop = (reason: Error) => {
      gaveUp = true;
      if (stream != null) destroy(stream);
      reject(reason);
    };
    timer = setTimeout(
      () => stop(new FileReadTimeoutError(timeoutMs)),
      timeoutMs,
    );
    onAbort = () => stop(new Error('Reading the stored file was abandoned'));
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    return await Promise.race([reading, giveUp]);
  } finally {
    clearTimeout(timer);
    if (onAbort != null) signal?.removeEventListener('abort', onAbort);
  }
};
