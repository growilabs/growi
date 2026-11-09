import { ZipFile } from 'yazl';

import { isWritableEntryName } from './zip-entry-writable';
import { createZipOutput } from './zip-output';

export interface PackagePart {
  readonly name: string;
  readonly body: Buffer;
}

// A fixed time keeps the bytes of a package independent of the clock.
export const PACKAGE_MTIME = new Date(1980, 0, 1);

/**
 * A stored (uncompressed) ZIP of in-memory parts, as the Python service writes
 * per-slide packages: sizes and CRC-32 sit in each local header, with no data
 * descriptor. Parts a ZIP writer cannot name are left out.
 */
export const writeStoredZip = (
  parts: readonly PackagePart[],
): Promise<Buffer> => {
  const output = createZipOutput(new ZipFile());
  try {
    for (const { name, body } of parts) {
      if (isWritableEntryName(name)) {
        output.zip.addBuffer(body, name, {
          compress: false,
          mtime: PACKAGE_MTIME,
        });
      }
    }
  } catch (error) {
    output.fail(error);
  }
  return output.finish();
};
