import type { Readable } from 'node:stream';

import {
  type ChildWarnings,
  decodeChildWarnings,
  MAX_CHILD_WARNING_BYTES,
  NO_CHILD_WARNINGS,
} from '../wire/child-warning';

/**
 * Keeps the first MAX_CHILD_WARNING_BYTES of a child's standard error and
 * reads the rest away, so the child never blocks on a full pipe and the parent
 * holds the same few bytes however much is written. Nothing is allocated for
 * a child that writes nothing. The returned function gives what was read so far.
 */
export const readChildWarnings = (
  stderr: Readable | null,
): (() => ChildWarnings) => {
  let kept: Buffer | null = null;
  let filled = 0;
  let overflowed = false;
  stderr?.on('data', (chunk: Buffer) => {
    const taken = Math.min(MAX_CHILD_WARNING_BYTES - filled, chunk.length);
    overflowed ||= taken < chunk.length;
    if (taken === 0) {
      return;
    }
    kept ??= Buffer.alloc(MAX_CHILD_WARNING_BYTES);
    chunk.copy(kept, filled, 0, taken);
    filled += taken;
  });
  return () =>
    kept === null
      ? NO_CHILD_WARNINGS
      : decodeChildWarnings(kept.subarray(0, filled), overflowed);
};
