import type { ConversionLimits } from '../contract';
import { WireProtocolError } from './wire-protocol-error';

/** The first frame on a child's stdin: everything but the file itself. */
export interface ChildHeader {
  readonly fileName: string;
  readonly mimeHint: string | null;
  readonly limits: ConversionLimits;
  /** Ceiling for the file frame that follows, so an absurd length is refused before allocating. */
  readonly maxInputBytes: number;
}

// The header carries the client's file name and MIME hint, which JSON escaping
// can grow sixfold; the ceiling only has to stop an absurd length header.
export const MAX_CHILD_HEADER_BYTES = 8 * 1024 * 1024;

const HEADER_KEYS = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (record: Record<string, unknown>, key: string): unknown => {
  if (!Object.hasOwn(record, key)) {
    throw new WireProtocolError(`child header has no ${key}`);
  }
  return record[key];
};

const count = (record: Record<string, unknown>, key: string): number => {
  const value = field(record, key);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new WireProtocolError(`child header ${key} is not a count`);
  }
  return value;
};

const decodeLimits = (value: unknown): ConversionLimits => {
  if (!isRecord(value)) {
    throw new WireProtocolError('child header limits is not an object');
  }
  const limits: ConversionLimits = {
    maxXlsxCells: count(value, 'maxXlsxCells'),
    maxPdfPages: count(value, 'maxPdfPages'),
    maxArchiveEntries: count(value, 'maxArchiveEntries'),
    maxArchiveUncompressedBytes: count(value, 'maxArchiveUncompressedBytes'),
    maxResultBytes: count(value, 'maxResultBytes'),
    maxCsvBytes: count(value, 'maxCsvBytes'),
    maxHtmlBytes: count(value, 'maxHtmlBytes'),
  };
  if (Object.keys(value).length !== Object.keys(limits).length) {
    throw new WireProtocolError('child header limits has unexpected fields');
  }
  return limits;
};

const parseJson = (body: Uint8Array): unknown => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    return JSON.parse(text);
  } catch {
    // JSON.parse quotes the input in its message: never pass it on.
    throw new WireProtocolError('child header is not valid UTF-8 JSON');
  }
};

export const encodeChildHeader = (header: ChildHeader): Buffer => {
  const body = Buffer.from(
    JSON.stringify({
      fileName: header.fileName,
      mimeHint: header.mimeHint,
      limits: header.limits,
      maxInputBytes: header.maxInputBytes,
    }),
    'utf8',
  );
  if (body.length > MAX_CHILD_HEADER_BYTES) {
    throw new WireProtocolError('child header exceeds the frame ceiling');
  }
  return body;
};

export const decodeChildHeader = (body: Uint8Array): ChildHeader => {
  const document = parseJson(body);
  if (!isRecord(document) || Object.keys(document).length !== HEADER_KEYS) {
    throw new WireProtocolError('child header has unexpected shape');
  }
  const fileName = field(document, 'fileName');
  const mimeHint = field(document, 'mimeHint');
  if (typeof fileName !== 'string') {
    throw new WireProtocolError('child header fileName is not a string');
  }
  if (mimeHint !== null && typeof mimeHint !== 'string') {
    throw new WireProtocolError('child header mimeHint is not a string');
  }
  return {
    fileName,
    mimeHint,
    limits: decodeLimits(field(document, 'limits')),
    maxInputBytes: count(document, 'maxInputBytes'),
  };
};
