import path from 'node:path';

import { isPathWithinBase } from '~/server/util/safe-path-utils';

/**
 * Build the on-disk storage path for a local attachment and guarantee it stays
 * within `basePath` (the uploads directory).
 *
 * `fileName` originates from an Attachment document and is normally a flat
 * md5 hash plus an extension, but a document imported via g2g transfer can carry
 * an attacker-crafted value. Resolving `<basePath>/<dirName>/<fileName>` and
 * asserting it is still inside `basePath` closes path traversal at the sink for
 * every operation that derives its path here (upload, delivery, delete, respond),
 * not just the transfer-receive write path.
 */
export const buildLocalStoragePath = (
  basePath: string,
  dirName: string,
  fileName: string,
): string => {
  const filePath = path.posix.join(basePath, dirName, fileName);

  if (!isPathWithinBase(filePath, basePath)) {
    throw new Error('Invalid attachment fileName: path traversal detected');
  }

  return filePath;
};
