/**
 * Validation for the attachment metadata a peer GROWI sends to the
 * `/g2g-transfer/attachment` receiver endpoint.
 *
 * The `fileName` here is attacker-controllable (it is taken verbatim from the
 * request body and later joined into the storage path at the file-uploader
 * sink: `<publicDir>/uploads/user/<fileName>` for the local uploader). A
 * legitimate attachment fileName is always a flat name (an md5 hash plus an
 * extension — see `models/attachment.ts`), so requiring a plain basename here
 * blocks path traversal (`../../evil`) without rejecting any real transfer.
 */

const MAX_FILE_NAME_LENGTH = 256;

const INVALID_METADATA_CODE = 'invalid_metadata';

export interface AttachmentMetadataValidationError {
  code: string;
  message: string;
}

/**
 * A safe fileName is a single path segment: no directory separators (`/` or
 * `\`), no parent/self references (`..`, `.`), and no NUL byte. This holds on
 * every platform, so a payload that traverses on Windows (`..\..\x`) is rejected
 * even though the production sink runs on POSIX.
 */
const isSafeFileName = (fileName: string): boolean => {
  if (fileName.includes('/') || fileName.includes('\\')) {
    return false;
  }
  if (fileName.includes('\0')) {
    return false;
  }
  if (fileName === '.' || fileName === '..') {
    return false;
  }
  return true;
};

/**
 * Validate the parsed attachment metadata. Returns `null` when it is safe to
 * proceed, or an error descriptor (to be surfaced as a 400) otherwise.
 */
export const validateAttachmentMetadata = (
  meta: unknown,
): AttachmentMetadataValidationError | null => {
  if (meta == null || typeof meta !== 'object') {
    return {
      code: INVALID_METADATA_CODE,
      message: 'Invalid attachment metadata.',
    };
  }

  const { fileName, fileSize } = meta as {
    fileName?: unknown;
    fileSize?: unknown;
  };

  if (
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    fileName.length > MAX_FILE_NAME_LENGTH ||
    !isSafeFileName(fileName)
  ) {
    return {
      code: INVALID_METADATA_CODE,
      message: 'Invalid fileName in attachment metadata.',
    };
  }

  if (
    typeof fileSize !== 'number' ||
    !Number.isInteger(fileSize) ||
    fileSize < 0
  ) {
    return {
      code: INVALID_METADATA_CODE,
      message: 'Invalid fileSize in attachment metadata.',
    };
  }

  return null;
};
