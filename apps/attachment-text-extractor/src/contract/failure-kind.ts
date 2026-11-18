export type FailureKind =
  | 'unsupported'
  | 'encrypted'
  | 'malformed'
  | 'limit_exceeded'
  | 'memory_exceeded'
  | 'result_too_large'
  | 'timeout'
  | 'crashed'
  | 'internal';
