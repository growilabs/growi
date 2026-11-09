import type { ErrorCode, FailureKind } from '../contract';

export const ERROR_TABLE: Readonly<
  Record<
    FailureKind,
    {
      readonly code: ErrorCode;
      readonly status: number;
      readonly message: string;
    }
  >
> = {
  unsupported: {
    code: 'unsupported_format',
    status: 400,
    message: 'unsupported: this file format is not supported',
  },
  encrypted: {
    code: 'file_encrypted',
    status: 422,
    message: 'encrypted: the document is password-protected',
  },
  malformed: {
    code: 'extraction_failed',
    status: 422,
    message: 'malformed: the document could not be read',
  },
  limit_exceeded: {
    code: 'resource_limit_exceeded',
    status: 422,
    message: 'limit_exceeded: the document exceeds a processing limit',
  },
  memory_exceeded: {
    code: 'resource_limit_exceeded',
    status: 422,
    message: 'memory_exceeded: the document needs more memory than allowed',
  },
  result_too_large: {
    code: 'resource_limit_exceeded',
    status: 422,
    message: 'result_too_large: the extracted text exceeds the allowed size',
  },
  timeout: {
    code: 'extraction_timeout',
    status: 408,
    message: 'timeout: the extraction took too long',
  },
  crashed: {
    code: 'extraction_failed',
    status: 500,
    message: 'crashed: the extraction process ended unexpectedly',
  },
  internal: {
    code: 'extraction_failed',
    status: 500,
    message: 'internal: unexpected extraction error',
  },
};
