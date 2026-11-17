/**
 * Thrown by `findDeliveryFile` only when the storage answered and the file
 * is not there. Any other failure (the storage did not answer, denied access,
 * a misconfigured bucket or container) stays a plain Error, so callers can
 * tell a missing file from a storage outage.
 */
export class AttachmentFileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentFileNotFoundError';
  }
}

const fieldOf = (err: unknown, key: string): unknown =>
  typeof err === 'object' && err != null
    ? (err as Record<string, unknown>)[key]
    : undefined;

export const isMissingLocalFile = (err: unknown): boolean =>
  fieldOf(err, 'code') === 'ENOENT';

/** HeadObject answers a missing key with a bodiless 404, named NotFound. */
export const isMissingS3Object = (err: unknown): boolean =>
  fieldOf(err, 'name') === 'NotFound' || fieldOf(err, 'code') === 'NotFound';

export const isMissingAzureBlob = (err: unknown): boolean =>
  fieldOf(err, 'statusCode') === 404 && fieldOf(err, 'code') === 'BlobNotFound';
