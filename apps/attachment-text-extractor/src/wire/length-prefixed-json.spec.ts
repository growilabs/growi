import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';

import type { ConversionOutcome, FailureKind } from '../contract';
import {
  decodeResult,
  encodeFrameHeader,
  encodeResult,
  maxResultFrameBytes,
  WireProtocolError,
  writeFrame,
} from './length-prefixed-json';

const framed = (body: Uint8Array): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
};

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

  it('hands the whole frame to a slow sink before it resolves', async () => {
    const body = Buffer.from(
      Uint8Array.from({ length: 256 * 1000 }, (_, i) => i % 256),
    );
    const writer = trickleWriter(777);

    await writeFrame(writer.sink, body);

    expect(writer.received()).toEqual(framed(body));
  });

  it('writes an empty frame as its header alone', async () => {
    const writer = trickleWriter(1);

    await writeFrame(writer.sink, Buffer.alloc(0));

    expect(writer.received()).toEqual(Buffer.from([0, 0, 0, 0]));
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

// Req 3.9 / 3.14: a result that fits in the frame must not cost the parent unbounded memory or time.
// A sync loop or an out-of-memory crash cannot be caught inside the test process, so each case runs
// in its own process with a hard time limit and a small heap.
describe('hostile result bodies in an isolated process', () => {
  const RESULT_JSON_URL = new URL('./result-json.ts', import.meta.url).href;
  const SMALL_HEAP_MB = 256;
  const TIME_LIMIT_MS = 20_000;

  // Prints the name of what decodeResult threw, or "decoded".
  const decodeInChild = (bodyExpression: string) =>
    spawnSync(
      process.execPath,
      [
        `--max-old-space-size=${SMALL_HEAP_MB}`,
        '--import',
        '@swc-node/register/esm-register',
        '--input-type=module',
        '--eval',
        `const { decodeResult } = await import(process.argv[1]);
         const body = ${bodyExpression};
         try { decodeResult(body); console.log('decoded'); }
         catch (error) { console.log(error.name); }`,
        RESULT_JSON_URL,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: TIME_LIMIT_MS },
    );

  const expectRefused = (bodyExpression: string): void => {
    const child = decodeInChild(bodyExpression);

    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe('WireProtocolError');
  };

  const DEPTH = 16 * 1024 * 1024;

  it('refuses a 32 MiB array nesting bomb without exhausting a small heap', () => {
    expectRefused(`Buffer.from('['.repeat(${DEPTH}) + ']'.repeat(${DEPTH}))`);
  }, 30_000);

  it('refuses a 32 MiB object nesting bomb without exhausting a small heap', () => {
    expectRefused(
      `Buffer.from('{"a":'.repeat(${DEPTH / 3}) + '1' + '}'.repeat(${DEPTH / 3}))`,
    );
  }, 30_000);

  // 32 MiB of empty containers: about 1 GB in JSON.parse, far over the small heap.
  it.each([
    ['empty objects', '{},'],
    ['empty arrays', '[],'],
  ])(
    'refuses a 32 MiB pages array of %s without exhausting a small heap',
    (_id, element) => {
      expectRefused(
        `Buffer.from('{"ok":true,"pages":[' + '${element}'.repeat(${(2 * DEPTH) / 3}) + '${element.slice(0, -1)}],"mimeType":"x"}')`,
      );
    },
    30_000,
  );

  it.each([
    ['an array element', '[1,"x\\\\'],
    ['an object value', '{"a":"b\\\\'],
    ['an object key', '{"a\\\\'],
  ])(
    'refuses %s that ends inside a string cut off at a backslash',
    (_id, literal) => {
      expectRefused(`Buffer.from('${literal}')`);
    },
    30_000,
  );
});
