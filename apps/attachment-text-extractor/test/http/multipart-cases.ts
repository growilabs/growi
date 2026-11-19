// The raw POST /extract requests of research.md 16.3 / 16.4, rebuilt from the
// descriptions there (the original byte files were lost with the scratchpad).
// Every case is generated here, deterministically; multipart-oracle.json holds
// what the Python service and its parser did with exactly these bytes, keyed
// by id and pinned by the sha1 of the request built with REQUEST_TOKEN.
// Imports nothing from src/: the black-box test sends these to Python too.

import type { MultipartCase } from './multipart-builders';
import { BODY_CASES } from './multipart-cases-body';
import { HTTP_CASES } from './multipart-cases-http';
import { PARAM_CASES } from './multipart-cases-params';

export {
  type MultipartCase,
  REQUEST_TOKEN,
  type RequestShape,
  rawRequest,
} from './multipart-builders';

export const MULTIPART_CASES: readonly MultipartCase[] = [
  ...BODY_CASES,
  ...PARAM_CASES,
  ...HTTP_CASES,
];

/** The cases a parser alone can take: one Content-Type, the body as sent. */
export const PARSER_CASES: readonly MultipartCase[] = MULTIPART_CASES.filter(
  (c) => c.request === undefined,
);
