import { PassThrough, Readable, Writable } from 'node:stream';

import type { ConversionOutcome, FailureKind } from '../contract';
import {
  decodeResult,
  encodeFrameHeader,
  encodeResult,
  maxResultFrameBytes,
  readFrame,
  WireProtocolError,
  writeFrame,
} from './length-prefixed-json';

const framed = (body: Uint8Array): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
};

function* pieces(data: Uint8Array, step: number): Generator<Buffer> {
  for (let start = 0; start < data.length; start += step) {
    yield Buffer.from(data.subarray(start, start + step));
  }
}

/** A byte stream that delivers at most `step` bytes per chunk, like a pipe with short reads. */
const trickleReader = (data: Uint8Array, step: number): Readable =>
  Readable.from(pieces(data, step), { objectMode: false });

/** A sink that applies backpressure every `step` bytes and acknowledges each write later. */
const trickleWriter = (step: number) => {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    highWaterMark: step,
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      setImmediate(callback);
    },
  });
  return { sink, received: (): Buffer => Buffer.concat(chunks) };
};

const json = (document: unknown): Buffer =>
  Buffer.from(JSON.stringify(document), 'utf8');

const page = (overrides: Record<string, unknown> = {}) => ({
  pageNumber: 1,
  label: '1',
  content: 'x',
  ...overrides,
});

const successDoc = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  pages: [page()],
  mimeType: 'application/pdf',
  ...overrides,
});

// The kinds the parent decides on its own (timeout, crashed, memory_exceeded) are excluded.
const CHILD_REPORTABLE_KINDS: readonly FailureKind[] = [
  'encrypted',
  'internal',
  'limit_exceeded',
  'malformed',
  'result_too_large',
  'unsupported',
];

describe('frames', () => {
  it('writes the length as a four-byte big-endian header', () => {
    expect(encodeFrameHeader(0x01020304)).toEqual(
      Buffer.from([0x01, 0x02, 0x03, 0x04]),
    );
  });

  it('round-trips a frame through a slow sink and short reads', async () => {
    const body = Buffer.from(
      Uint8Array.from({ length: 256 * 1000 }, (_, i) => i % 256),
    );
    const writer = trickleWriter(777);

    await writeFrame(writer.sink, body);

    // Everything is handed over by the time the promise resolves.
    expect(writer.received()).toEqual(framed(body));
    await expect(
      readFrame(trickleReader(writer.received(), 3), body.length),
    ).resolves.toEqual(body);
  });

  it('round-trips an empty frame', async () => {
    const writer = trickleWriter(1);

    await writeFrame(writer.sink, Buffer.alloc(0));

    await expect(
      readFrame(trickleReader(writer.received(), 1), 0),
    ).resolves.toEqual(Buffer.alloc(0));
  });

  // Node addition: the parent sends the header frame and the file frame on one stdin (design.md Data Contracts).
  it('reads two frames sent back to back on one stream', async () => {
    const first = Buffer.from('{"fileName":"a.pdf"}');
    const second = Buffer.from('file bytes');
    const stream = trickleReader(
      Buffer.concat([framed(first), framed(second)]),
      5,
    );

    await expect(readFrame(stream, 100)).resolves.toEqual(first);
    await expect(readFrame(stream, 100)).resolves.toEqual(second);
  });

  it('rejects a length over the maximum from the header alone', async () => {
    // The stream never ends: a reader that waited for the body would hang.
    const stream = new PassThrough();
    stream.write(Buffer.from([0xff, 0xff, 0xff, 0xff]));

    await expect(readFrame(stream, 50 * 1024 * 1024)).rejects.toThrow(
      WireProtocolError,
    );
    stream.destroy();
  });

  // Node addition: the boundary next to the round trip at exactly maxLength.
  it('rejects a length one byte over the maximum', async () => {
    await expect(
      readFrame(trickleReader(framed(Buffer.from('abcdef')), 2), 5),
    ).rejects.toThrow(WireProtocolError);
  });

  it('rejects a truncated header', async () => {
    await expect(
      readFrame(trickleReader(Buffer.from([0, 0]), 1), 10),
    ).rejects.toThrow(WireProtocolError);
  });

  it('rejects a truncated body', async () => {
    const truncated = framed(Buffer.from('abcdef')).subarray(0, -2);

    await expect(readFrame(trickleReader(truncated, 2), 10)).rejects.toThrow(
      WireProtocolError,
    );
  });

  it('cannot encode a length beyond four bytes', () => {
    expect(() => encodeFrameHeader(2 ** 32)).toThrow(RangeError);
  });

  it('leaves room for JSON escaping in the result frame ceiling', () => {
    const limit = 16 * 1024 * 1024;

    expect(maxResultFrameBytes(limit)).toBeGreaterThanOrEqual(2 * limit);
    expect(maxResultFrameBytes(2 ** 40)).toBe(0xffff_ffff);
  });
});

describe('result JSON', () => {
  it('round-trips a success using the design field names', () => {
    const success: ConversionOutcome = {
      kind: 'ok',
      mimeType: 'application/pdf',
      pages: [
        { pageNumber: 1, label: '1', content: '情報システム\n計画' },
        { pageNumber: null, label: null, content: '' },
      ],
    };

    const body = encodeResult(success);

    expect(JSON.parse(body.toString('utf8'))).toEqual({
      ok: true,
      pages: [
        { pageNumber: 1, label: '1', content: '情報システム\n計画' },
        { pageNumber: null, label: null, content: '' },
      ],
      mimeType: 'application/pdf',
    });
    // Japanese stays raw UTF-8 (3 bytes per character), not \uXXXX escapes.
    expect(body.includes(Buffer.from('情報', 'utf8'))).toBe(true);
    expect(decodeResult(body)).toEqual(success);
  });

  it('round-trips a failure', () => {
    const failure: ConversionOutcome = {
      kind: 'failed',
      failure: 'malformed',
      detail: 'pdf could not be opened',
    };

    const body = encodeResult(failure);

    expect(JSON.parse(body.toString('utf8'))).toEqual({
      ok: false,
      kind: 'malformed',
      detail: 'pdf could not be opened',
    });
    expect(decodeResult(body)).toEqual(failure);
  });

  // Node decision: JSON.stringify would emit a \ud800 escape the parent rejects and
  // TextEncoder would silently write U+FFFD, so encoding refuses it like Python's strict UTF-8.
  it('refuses to encode a lone surrogate', () => {
    expect(() =>
      encodeResult({
        kind: 'ok',
        mimeType: 'text/plain',
        pages: [{ pageNumber: null, label: null, content: 'a\ud800b' }],
      }),
    ).toThrow(WireProtocolError);
  });

  it.each([
    ['non-utf8', Buffer.from([0xff, 0xfe, ...Buffer.from(' not utf-8')])],
    ['invalid-json', Buffer.from('{not json')],
    ['empty', Buffer.alloc(0)],
    ['not-an-object', Buffer.from('[]')],
    [
      'ok-not-bool',
      Buffer.from('{"ok": 1, "kind": "internal", "detail": "x"}'),
    ],
    ['ok-missing', Buffer.from('{"kind": "internal", "detail": "x"}')],
    [
      'duplicate-key',
      Buffer.from(
        '{"ok": false, "ok": false, "kind": "internal", "detail": "x"}',
      ),
    ],
    [
      'nan',
      Buffer.from(
        '{"ok": true, "pages": [{"pageNumber": NaN, "label": null, "content": ""}], "mimeType": "a"}',
      ),
    ],
    [
      'int-beyond-digit-limit',
      Buffer.from(
        `{"ok": true, "pages": [{"pageNumber": ${'9'.repeat(5000)}, "label": null, "content": ""}], "mimeType": "a"}`,
      ),
    ],
    [
      'deep-nesting',
      Buffer.from(`${'['.repeat(100_000)}${']'.repeat(100_000)}`),
    ],
    [
      'escaped-lone-surrogate',
      Buffer.from(
        '{"ok": true, "pages": [{"pageNumber": 1, "label": "\\ud800", "content": ""}], "mimeType": "a"}',
      ),
    ],
    // Node additions: the other non-JSON constants Python's parse_constant rejected.
    [
      'infinity',
      Buffer.from(
        '{"ok": true, "pages": [{"pageNumber": Infinity, "label": null, "content": ""}], "mimeType": "a"}',
      ),
    ],
    [
      'negative-infinity',
      Buffer.from(
        '{"ok": true, "pages": [{"pageNumber": -Infinity, "label": null, "content": ""}], "mimeType": "a"}',
      ),
    ],
  ])('rejects the malformed body %s with the protocol error', (_id, body) => {
    expect(() => decodeResult(body)).toThrow(WireProtocolError);
  });

  it.each([
    ['extra-top-level-field', successDoc({ extra: 1 })],
    ['missing-mimeType', { ok: true, pages: [page()] }],
    ['empty-mimeType', successDoc({ mimeType: '' })],
    ['mimeType-not-str', successDoc({ mimeType: 5 })],
    ['no-pages', successDoc({ pages: [] })],
    ['pages-not-list', successDoc({ pages: 'x' })],
    ['page-not-object', successDoc({ pages: ['x'] })],
    ['extra-page-field', successDoc({ pages: [{ ...page(), extra: 1 }] })],
    ['missing-content', successDoc({ pages: [{ pageNumber: 1, label: '1' }] })],
    ['pageNumber-bool', successDoc({ pages: [page({ pageNumber: true })] })],
    // Python used 1.0; JSON.parse reads 1.0 as the integer 1, so a fractional value stands in.
    ['pageNumber-float', successDoc({ pages: [page({ pageNumber: 1.5 })] })],
    ['pageNumber-str', successDoc({ pages: [page({ pageNumber: '1' })] })],
    ['pageNumber-zero', successDoc({ pages: [page({ pageNumber: 0 })] })],
    ['pageNumber-negative', successDoc({ pages: [page({ pageNumber: -1 })] })],
    ['pageNumber-huge', successDoc({ pages: [page({ pageNumber: 2 ** 31 })] })],
    ['label-not-str', successDoc({ pages: [page({ label: 3 })] })],
    ['content-null', successDoc({ pages: [page({ content: null })] })],
    ['failure-missing-detail', { ok: false, kind: 'internal' }],
    [
      'failure-extra-field',
      { ok: false, kind: 'internal', detail: 'x', trace: 'y' },
    ],
    ['unknown-kind', { ok: false, kind: 'no_such_kind', detail: 'x' }],
    ['parent-only-timeout', { ok: false, kind: 'timeout', detail: 'x' }],
    ['parent-only-crashed', { ok: false, kind: 'crashed', detail: 'x' }],
    ['parent-only-memory', { ok: false, kind: 'memory_exceeded', detail: 'x' }],
    ['detail-not-str', { ok: false, kind: 'internal', detail: 1 }],
    [
      'detail-too-long',
      { ok: false, kind: 'internal', detail: 'x'.repeat(10_000) },
    ],
  ])('rejects the schema violation %s with the protocol error', (_id, document) => {
    expect(() => decodeResult(json(document))).toThrow(WireProtocolError);
  });

  it.each(
    CHILD_REPORTABLE_KINDS,
  )('accepts the kind %s the child may report', (kind) => {
    const body = encodeResult({ kind: 'failed', failure: kind, detail: 'd' });

    expect(decodeResult(body)).toEqual({
      kind: 'failed',
      failure: kind,
      detail: 'd',
    });
  });
});

// Req 3.9: what a hijacked child sends is parsed as data and never evaluated or merged into objects.
describe('child-sent data is never treated as code', () => {
  it.each([
    [
      'top-level __proto__',
      '{"ok": false, "kind": "internal", "detail": "x", "__proto__": {"polluted": true}}',
    ],
    [
      'page __proto__',
      '{"ok": true, "pages": [{"pageNumber": 1, "label": "1", "content": "x", "__proto__": {"polluted": true}}], "mimeType": "a"}',
    ],
    [
      'top-level constructor',
      '{"ok": false, "kind": "internal", "detail": "x", "constructor": {"prototype": {"polluted": true}}}',
    ],
  ])('rejects a %s key without polluting any prototype', (_id, body) => {
    expect(() => decodeResult(Buffer.from(body))).toThrow(WireProtocolError);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect({}).not.toHaveProperty('polluted');
  });

  it('returns code-shaped strings verbatim as plain data', () => {
    const content =
      'function () { globalThis.hijacked = true; process.exit(1); }';

    const outcome = decodeResult(
      json(successDoc({ pages: [page({ content })] })),
    );

    expect(outcome).toEqual({
      kind: 'ok',
      mimeType: 'application/pdf',
      pages: [{ pageNumber: 1, label: '1', content }],
    });
    expect(globalThis).not.toHaveProperty('hijacked');
  });
});
