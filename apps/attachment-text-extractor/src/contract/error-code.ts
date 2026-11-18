// The only value in contract/: the order is the OpenAPI ErrorCode enum's.
export const ERROR_CODES = [
  'unauthorized',
  'unsupported_format',
  'file_too_large',
  'extraction_timeout',
  'service_busy',
  'extraction_failed',
  'file_encrypted',
  'resource_limit_exceeded',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
