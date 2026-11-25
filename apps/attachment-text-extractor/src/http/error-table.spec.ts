import { ERROR_CODES } from '../contract/error-code';
import {
  ERROR_TABLE,
  EXTRACT_RESULTS,
  extractErrorStatuses,
  UNAUTHORIZED_ANSWER,
} from './error-table';

// The one table from a failure kind to ErrorCode, HTTP status and the fixed
// message. A missing kind is a type error (Record over
// FailureKind); this test pins the values: the target spec's design.md
// §Error Handling, with the Python service's fixed texts (extract_errors.py).

describe('ERROR_TABLE', () => {
  it('maps every failure kind to the code, status and message of the target spec', () => {
    expect(ERROR_TABLE).toEqual({
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
        message:
          'result_too_large: the extracted text exceeds the allowed size',
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
    });
  });
});

describe('ERROR_CODES', () => {
  it('are the eight codes of the contract, in the documented order', () => {
    expect(ERROR_CODES).toEqual([
      'unauthorized',
      'unsupported_format',
      'file_too_large',
      'extraction_timeout',
      'service_busy',
      'extraction_failed',
      'file_encrypted',
      'resource_limit_exceeded',
    ]);
  });
});

describe('extractErrorStatuses', () => {
  it('lists the 401 unauthorized answer of the Bearer check', () => {
    expect(extractErrorStatuses().get(401)).toEqual(['unauthorized']);
    expect(UNAUTHORIZED_ANSWER).toEqual({
      code: 'unauthorized',
      status: 401,
      message: 'Missing or invalid Bearer token',
    });
  });
});

describe('EXTRACT_RESULTS', () => {
  it('is ok, every failure kind and every refusal, each once', () => {
    expect([...EXTRACT_RESULTS].sort()).toEqual(
      [
        'ok',
        'unsupported',
        'encrypted',
        'malformed',
        'limit_exceeded',
        'memory_exceeded',
        'result_too_large',
        'timeout',
        'crashed',
        'internal',
        'file_too_large',
        'service_busy',
        'upload_timeout',
        'invalid_upload',
        'client_disconnected',
      ].sort(),
    );
  });
});
