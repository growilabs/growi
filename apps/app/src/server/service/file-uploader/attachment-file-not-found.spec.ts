import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isMissingAzureBlob,
  isMissingLocalFile,
  isMissingS3Object,
} from './attachment-file-not-found';

const errorOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
};

describe('missing-file classification (only a positively identified miss)', () => {
  it('local: a path that does not exist is missing; other stat errors are not', () => {
    const absent = path.join(os.tmpdir(), `growi-missing-${Date.now()}`);

    expect(isMissingLocalFile(errorOf(() => fs.statSync(absent)))).toBe(true);
    expect(
      isMissingLocalFile(
        Object.assign(new Error('denied'), { code: 'EACCES' }),
      ),
    ).toBe(false);
    expect(
      isMissingLocalFile(Object.assign(new Error('io'), { code: 'EIO' })),
    ).toBe(false);
  });

  it('S3: a HeadObject NotFound is missing; a network or server error is not', () => {
    expect(
      isMissingS3Object(
        Object.assign(new Error('NotFound'), {
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        }),
      ),
    ).toBe(true);
    expect(
      isMissingS3Object(
        Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
      ),
    ).toBe(false);
    expect(
      isMissingS3Object(
        Object.assign(new Error('Service Unavailable'), {
          name: 'ServiceUnavailable',
          $metadata: { httpStatusCode: 503 },
        }),
      ),
    ).toBe(false);
  });

  it('Azure: BlobNotFound is missing; a missing container (misconfiguration) is not', () => {
    const restError = (statusCode: number, code: string) =>
      Object.assign(new Error(code), { name: 'RestError', statusCode, code });

    expect(isMissingAzureBlob(restError(404, 'BlobNotFound'))).toBe(true);
    expect(isMissingAzureBlob(restError(404, 'ContainerNotFound'))).toBe(false);
    expect(isMissingAzureBlob(restError(503, 'ServerBusy'))).toBe(false);
  });
});
