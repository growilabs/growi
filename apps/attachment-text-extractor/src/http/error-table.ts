import type { ErrorCode, FailureKind } from '../contract';

// Every error answer of POST /extract, in two tables: the failures a
// conversion ends with, and the refusals the HTTP layer gives before or
// around one. The OpenAPI document lists its error statuses from both.

interface ErrorAnswer {
  readonly code: ErrorCode;
  readonly status: number;
}

export const ERROR_TABLE: Readonly<
  Record<FailureKind, ErrorAnswer & { readonly message: string }>
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

/** What the HTTP layer refuses with; also the `result` of the request log line. */
export type Refusal =
  | 'file_too_large'
  | 'service_busy'
  | 'upload_timeout'
  | 'invalid_upload'
  | 'client_disconnected';

export const REFUSAL_TABLE: Readonly<Record<Refusal, ErrorAnswer>> = {
  file_too_large: { code: 'file_too_large', status: 413 },
  service_busy: { code: 'service_busy', status: 503 },
  upload_timeout: { code: 'extraction_timeout', status: 408 },
  invalid_upload: { code: 'extraction_failed', status: 422 },
  client_disconnected: { code: 'extraction_failed', status: 422 },
};

/** Each error status of POST /extract, ascending, with the codes it carries. */
export const extractErrorStatuses = (): ReadonlyMap<
  number,
  readonly ErrorCode[]
> => {
  const answers: readonly ErrorAnswer[] = [
    ...Object.values(ERROR_TABLE),
    ...Object.values(REFUSAL_TABLE),
  ];
  const statuses = [...new Set(answers.map(({ status }) => status))].toSorted(
    (a, b) => a - b,
  );
  return new Map(
    statuses.map((status) => [
      status,
      [
        ...new Set(
          answers
            .filter((answer) => answer.status === status)
            .map(({ code }) => code),
        ),
      ],
    ]),
  );
};
