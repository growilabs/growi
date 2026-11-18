import type { ConversionLimits } from '../contract';
import {
  type ChildHeader,
  decodeChildHeader,
  encodeChildHeader,
  MAX_CHILD_HEADER_BYTES,
} from './child-header';
import { WireProtocolError } from './wire-protocol-error';

// The header frame the runner sends a child before the file (design.md Data
// Contracts): what the child needs to call convert() and to bound the file frame.

const MIB = 1024 * 1024;

const LIMITS: ConversionLimits = {
  maxXlsxCells: 70_000,
  maxPdfPages: 5_000,
  maxArchiveEntries: 10_000,
  maxArchiveUncompressedBytes: 512 * MIB,
  maxResultBytes: 16 * MIB,
  maxCsvBytes: 8 * MIB,
  maxHtmlBytes: 20 * MIB,
};

const HEADER: ChildHeader = {
  fileName: '議事録 "最終".pdf',
  mimeHint: 'application/pdf',
  limits: LIMITS,
  maxInputBytes: 50 * MIB,
};

const json = (document: unknown): Buffer =>
  Buffer.from(JSON.stringify(document), 'utf8');

describe('child header', () => {
  it('round-trips what the runner sends', () => {
    expect(decodeChildHeader(encodeChildHeader(HEADER))).toEqual(HEADER);
  });

  it('round-trips a missing MIME hint and an empty file name', () => {
    const header: ChildHeader = { ...HEADER, fileName: '', mimeHint: null };

    expect(decodeChildHeader(encodeChildHeader(header))).toEqual(header);
  });

  // Multipart decoding can hand over a lone surrogate; the header is not a
  // response, so it travels as is.
  it('round-trips a file name holding a lone surrogate', () => {
    const header: ChildHeader = { ...HEADER, fileName: 'a\ud800.txt' };

    expect(decodeChildHeader(encodeChildHeader(header))).toEqual(header);
  });

  it('refuses to encode a header over the frame ceiling', () => {
    const header: ChildHeader = {
      ...HEADER,
      fileName: 'x'.repeat(MAX_CHILD_HEADER_BYTES),
    };

    expect(() => encodeChildHeader(header)).toThrow(WireProtocolError);
  });

  it.each([
    ['not-utf8', Buffer.from([0xff, 0xfe, 0x7b, 0x7d])],
    ['not-json', Buffer.from('{fileName')],
    ['empty', Buffer.alloc(0)],
    ['array', json([HEADER])],
    ['missing-limits', json({ ...HEADER, limits: undefined })],
    ['extra-field', json({ ...HEADER, extra: 1 })],
    ['fileName-number', json({ ...HEADER, fileName: 1 })],
    ['mimeHint-number', json({ ...HEADER, mimeHint: 1 })],
    ['maxInputBytes-negative', json({ ...HEADER, maxInputBytes: -1 })],
    ['maxInputBytes-fraction', json({ ...HEADER, maxInputBytes: 1.5 })],
    ['maxInputBytes-string', json({ ...HEADER, maxInputBytes: '1' })],
    ['limits-array', json({ ...HEADER, limits: [] })],
    [
      'limit-missing',
      json({ ...HEADER, limits: { ...LIMITS, maxPdfPages: undefined } }),
    ],
    ['limit-extra', json({ ...HEADER, limits: { ...LIMITS, maxPages: 1 } })],
    [
      'limit-negative',
      json({ ...HEADER, limits: { ...LIMITS, maxPdfPages: -1 } }),
    ],
    [
      'limit-null',
      json({ ...HEADER, limits: { ...LIMITS, maxCsvBytes: null } }),
    ],
    [
      'limit-unsafe-integer',
      json({ ...HEADER, limits: { ...LIMITS, maxCsvBytes: 2 ** 60 } }),
    ],
  ])('rejects the malformed header %s with the protocol error', (_id, body) => {
    expect(() => decodeChildHeader(body)).toThrow(WireProtocolError);
  });

  // The child writes nothing derived from its input; an error message that
  // quoted the header would carry the client's file name into the logs.
  it('does not quote the header in its error', () => {
    const marker = 'secret-file-name-7c1f';

    const thrown = (() => {
      try {
        decodeChildHeader(Buffer.from(`{"fileName":"${marker}",`));
      } catch (error) {
        return error;
      }
      return null;
    })();

    expect(thrown).toBeInstanceOf(WireProtocolError);
    expect(String(thrown)).not.toContain(marker);
  });
});
