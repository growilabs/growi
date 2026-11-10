import type { Readable } from 'node:stream';

const FRAME_HEADER_SIZE = 4;

export type ResultFrameEnding =
  | { readonly kind: 'frame'; readonly body: Buffer }
  /** The length alone is over the ceiling; nothing of the body was kept. */
  | { readonly kind: 'oversize' }
  /** The pipe ended or failed before a whole frame arrived. */
  | { readonly kind: 'eof' };

/**
 * Reads the child's one result frame. The body goes into a single buffer of
 * the announced length, filled as the pieces arrive, so the parent never holds
 * the pieces and a joined copy at once (research.md 20.10, decision A).
 * Calls `onEnd` exactly once and stops reading after it.
 */
export const readResultFrame = (
  stream: Readable,
  maxBodyBytes: number,
  onEnd: (ending: ResultFrameEnding) => void,
): void => {
  const header = Buffer.alloc(FRAME_HEADER_SIZE);
  let headerFilled = 0;
  let body: Buffer | null = null;
  let bodyFilled = 0;
  let ended = false;

  const end = (ending: ResultFrameEnding): void => {
    if (ended) {
      return;
    }
    ended = true;
    body = null;
    stream.off('data', onData);
    stream.destroy();
    onEnd(ending);
  };

  // Returns where the body starts in the chunk, or -1 while the header is incomplete.
  const takeHeader = (chunk: Buffer): number => {
    const taken = Math.min(FRAME_HEADER_SIZE - headerFilled, chunk.length);
    chunk.copy(header, headerFilled, 0, taken);
    headerFilled += taken;
    if (headerFilled < FRAME_HEADER_SIZE) {
      return -1;
    }
    const length = header.readUInt32BE(0);
    if (length > maxBodyBytes) {
      end({ kind: 'oversize' });
      return -1;
    }
    body = Buffer.allocUnsafe(length);
    return taken;
  };

  function onData(chunk: Buffer): void {
    const start = body === null ? takeHeader(chunk) : 0;
    const target = body;
    if (start < 0 || target === null) {
      return;
    }
    const taken = Math.min(target.length - bodyFilled, chunk.length - start);
    chunk.copy(target, bodyFilled, start, start + taken);
    bodyFilled += taken;
    if (bodyFilled === target.length) {
      end({ kind: 'frame', body: target });
    }
  }

  stream.on('data', onData);
  stream.on('end', () => end({ kind: 'eof' }));
  stream.on('close', () => end({ kind: 'eof' }));
  stream.on('error', () => end({ kind: 'eof' }));
};
