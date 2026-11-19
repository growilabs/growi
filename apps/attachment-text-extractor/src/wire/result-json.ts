import type { ConversionOutcome, FailureKind, PageInfo } from '../contract';
import {
  type ResultSkeleton,
  rejectUnsafeStructure,
} from './json-structure-guard';
import { WireProtocolError } from './wire-protocol-error';

// Kinds the parent decides on its own (timeout / crashed / memory_exceeded) are not accepted
// from the child: a child must not be able to impersonate the parent's own classification.
export const CHILD_REPORTABLE_KINDS = [
  'unsupported',
  'encrypted',
  'malformed',
  'limit_exceeded',
  'result_too_large',
  'internal',
] as const satisfies readonly FailureKind[];

/** In code points, as Python's len() counted them. */
export const MAX_DETAIL_CHARS = 512;
const MAX_PAGE_NUMBER = 2 ** 31 - 1;
const SUCCESS_KEYS: readonly string[] = ['ok', 'pages', 'mimeType'];
const FAILURE_KEYS: readonly string[] = ['ok', 'kind', 'detail'];
const PAGE_KEYS: readonly string[] = ['pageNumber', 'label', 'content'];
// The guard requires every page to carry all of PAGE_KEYS and refuses a nested object or array as
// a field value: adding an optional or nested field means changing the guard with it.
const RESULT_SKELETON: ResultSkeleton = {
  topKeys: [...SUCCESS_KEYS, ...FAILURE_KEYS],
  elementKeys: PAGE_KEYS,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (
  record: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(record);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(record, key))
  );
};

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new WireProtocolError(`${field} is not a string`);
  }
  // A \udXXX escape decodes to a lone surrogate, which would break the HTTP response later.
  if (!value.isWellFormed()) {
    throw new WireProtocolError(`${field} contains a lone surrogate`);
  }
  return value;
};

const countCodePoints = (text: string): number => {
  let count = 0;
  for (const _ of text) {
    count += 1;
  }
  return count;
};

const encodeJson = (document: unknown): Buffer =>
  // JSON.stringify keeps non-ASCII characters raw: Japanese stays at 3 bytes per character, not 6.
  Buffer.from(JSON.stringify(document), 'utf8');

const requireEncodable = (text: string | null, field: string): void => {
  if (text !== null && !text.isWellFormed()) {
    throw new WireProtocolError(`${field} contains a lone surrogate`);
  }
};

export const encodeResult = (outcome: ConversionOutcome): Buffer => {
  if (outcome.kind === 'failed') {
    requireEncodable(outcome.detail, 'detail');
    return encodeJson({
      ok: false,
      kind: outcome.failure,
      detail: outcome.detail,
    });
  }
  requireEncodable(outcome.mimeType, 'mimeType');
  for (const page of outcome.pages) {
    requireEncodable(page.label, 'label');
    requireEncodable(page.content, 'content');
  }
  return encodeJson({
    ok: true,
    pages: outcome.pages.map(({ pageNumber, label, content }) => ({
      pageNumber,
      label,
      content,
    })),
    mimeType: outcome.mimeType,
  });
};

const parseJson = (body: Uint8Array): unknown => {
  try {
    // ignoreBOM keeps a leading BOM in the text so that JSON.parse refuses it.
    const text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(body);
    rejectUnsafeStructure(text, RESULT_SKELETON);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof WireProtocolError) {
      throw error;
    }
    throw new WireProtocolError('result is not valid UTF-8 JSON');
  }
};

const decodePage = (page: unknown): PageInfo => {
  if (!isRecord(page) || !hasExactKeys(page, PAGE_KEYS)) {
    throw new WireProtocolError('page has unexpected shape');
  }
  const { pageNumber, label, content } = page;
  if (
    pageNumber !== null &&
    !(
      typeof pageNumber === 'number' &&
      Number.isInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= MAX_PAGE_NUMBER
    )
  ) {
    throw new WireProtocolError('pageNumber is not a positive integer');
  }
  return {
    pageNumber,
    label: label === null ? null : requireString(label, 'label'),
    content: requireString(content, 'content'),
  };
};

const decodeSuccess = (
  document: Record<string, unknown>,
): ConversionOutcome => {
  if (!hasExactKeys(document, SUCCESS_KEYS)) {
    throw new WireProtocolError('success result has unexpected fields');
  }
  const { pages, mimeType } = document;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new WireProtocolError('success result needs at least one page');
  }
  const mime = requireString(mimeType, 'mimeType');
  if (mime === '') {
    throw new WireProtocolError('mimeType is empty');
  }
  return { kind: 'ok', mimeType: mime, pages: pages.map(decodePage) };
};

const decodeFailure = (
  document: Record<string, unknown>,
): ConversionOutcome => {
  if (!hasExactKeys(document, FAILURE_KEYS)) {
    throw new WireProtocolError('failure result has unexpected fields');
  }
  const failure = CHILD_REPORTABLE_KINDS.find((kind) => kind === document.kind);
  if (failure === undefined) {
    throw new WireProtocolError('failure kind is not one the child may report');
  }
  const detail = requireString(document.detail, 'detail');
  // Code points, not UTF-16 units; counting is skipped while the length alone proves it is short enough.
  if (
    detail.length > MAX_DETAIL_CHARS &&
    countCodePoints(detail) > MAX_DETAIL_CHARS
  ) {
    throw new WireProtocolError('failure detail is too long');
  }
  return { kind: 'failed', failure, detail };
};

export const decodeResult = (body: Uint8Array): ConversionOutcome => {
  const document = parseJson(body);
  if (!isRecord(document)) {
    throw new WireProtocolError('result is not a JSON object');
  }
  if (document.ok === true) {
    return decodeSuccess(document);
  }
  if (document.ok === false) {
    return decodeFailure(document);
  }
  throw new WireProtocolError('result has no boolean ok field');
};
