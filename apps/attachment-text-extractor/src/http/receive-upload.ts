import type { IncomingMessage } from 'node:http';

import type { MultipartParser, MultipartUpload } from './parse-multipart';

// Reading the POST /extract body into the parser as it arrives (research.md
// 16.1 1, 16.9): from the Node request stream itself, never c.req.raw.body
// (that web stream copies every chunk once more), held in memory only.

export class UploadTooLarge extends Error {}
export class UploadTimeout extends Error {}
export class UploadDisconnected extends Error {}

export interface ReceiveLimits {
  /** The whole body, counted as it arrives: the file limit plus the framing. */
  readonly maxBodyBytes: number;
  readonly timeoutMs: number;
}

interface BodyEvents {
  readonly onData: (chunk: Buffer) => void;
  readonly onEnd: () => void;
  readonly onGone: () => void;
}

/** Listens to the body until the returned function is called. */
const listen = (
  incoming: IncomingMessage,
  signal: AbortSignal,
  { onData, onEnd, onGone }: BodyEvents,
): (() => void) => {
  // A body cut off mid-way closes before it is complete; one read whole and
  // abandoned later aborts the signal.
  const onClose = (): void => {
    if (!incoming.complete) onGone();
  };
  incoming
    .on('data', onData)
    .on('end', onEnd)
    .on('error', onGone)
    .on('close', onClose);
  signal.addEventListener('abort', onGone);
  return () => {
    incoming
      .off('data', onData)
      .off('end', onEnd)
      .off('error', onGone)
      .off('close', onClose);
    signal.removeEventListener('abort', onGone);
  };
};

/**
 * One deadline for the whole body; the byte cap counts what arrived, not
 * what was declared. The parser is synchronous, so the deadline and the
 * disconnect listeners only matter for slow bodies. A malformed body rejects
 * with the parser's InvalidMultipart.
 */
export const receiveUpload = (
  incoming: IncomingMessage,
  parser: MultipartParser,
  signal: AbortSignal,
  limits: ReceiveLimits,
): Promise<MultipartUpload> =>
  new Promise((resolve, reject) => {
    let received = 0;
    let settled = false;
    const settle = (error: unknown, upload?: MultipartUpload): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      if (upload === undefined) {
        incoming.pause();
        reject(error);
      } else {
        resolve(upload);
      }
    };
    const timer = setTimeout(
      () => settle(new UploadTimeout()),
      limits.timeoutMs,
    );
    const stop = listen(incoming, signal, {
      onData: (chunk) => {
        received += chunk.length;
        if (received > limits.maxBodyBytes) {
          settle(new UploadTooLarge());
          return;
        }
        try {
          parser.write(chunk);
        } catch (error) {
          settle(error);
        }
      },
      onEnd: () => {
        try {
          settle(undefined, parser.end());
        } catch (error) {
          settle(error);
        }
      },
      onGone: () => settle(new UploadDisconnected()),
    });
    if (signal.aborted) settle(new UploadDisconnected());
  });
