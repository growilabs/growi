// Builders for the raw POST /extract requests of multipart-cases.ts (research.md
// 16.3 / 16.4). Imports nothing from src/: the black-box tests send these to
// the Python service too.

export const REQUEST_TOKEN = 'TOKEN';

export interface RequestShape {
  readonly method?: string;
  readonly path?: string;
  readonly version?: '1.0' | '1.1';
  readonly host?: boolean;
  /** Overrides the single Content-Type line (duplicates, none). */
  readonly contentTypes?: readonly string[];
  /** Authorization lines; `{token}` is replaced; default: one valid line. */
  readonly authorizations?: readonly string[];
  readonly framing?: 'length' | 'chunked' | { readonly declaredDelta: number };
  /** Raw header lines, written as they are after the others. */
  readonly extra?: readonly string[];
  /** Replaces the Content-Length line(s) entirely. */
  readonly lengthLines?: readonly string[];
}

export interface MultipartCase {
  readonly id: string;
  readonly about: string;
  readonly contentType: string;
  readonly body: Buffer;
  /** Absent: a plain POST /extract with Content-Length; only these go to the parser alone. */
  readonly request?: RequestShape;
}

export const B = 'XyZb0undary';
export const CRLF = '\r\n';

export const ctOf = (boundary: string = B, tail = ''): string =>
  `multipart/form-data; boundary=${boundary}${tail}`;

export type Bytes = Buffer | string;
export const buf = (value: Bytes): Buffer =>
  typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
export const latin1 = (value: string): Buffer => Buffer.from(value, 'latin1');

/** One part: header lines (written as given), blank line, data. */
export const part = (headers: readonly Bytes[], data: Bytes): Buffer =>
  Buffer.concat([
    ...headers.flatMap((h) => [buf(h), latin1(CRLF)]),
    latin1(CRLF),
    buf(data),
  ]);

export const disposition = (params: Bytes): Buffer =>
  Buffer.concat([latin1('Content-Disposition: form-data; '), buf(params)]);

export const filePart = (params: Bytes, data: Bytes = 'hello'): Buffer =>
  part([disposition(params), 'Content-Type: text/plain'], data);

export const named = (fileName: string): string =>
  `name="file"; filename="${fileName}"`;

export const field = (name: string, value: Bytes): Buffer =>
  part([disposition(`name="${name}"`)], value);

export interface BodyOptions {
  readonly boundary?: string;
  readonly preamble?: Bytes;
  readonly epilogue?: Bytes;
  readonly close?: boolean;
}

export const multipart = (
  parts: readonly Buffer[],
  options: BodyOptions = {},
): Buffer => {
  const boundary = options.boundary ?? B;
  return Buffer.concat([
    buf(options.preamble ?? ''),
    ...parts.flatMap((p, i) => [
      latin1(`${i === 0 ? '' : CRLF}--${boundary}${CRLF}`),
      p,
    ]),
    options.close === false
      ? Buffer.alloc(0)
      : latin1(`${CRLF}--${boundary}--${CRLF}`),
    buf(options.epilogue ?? ''),
  ]);
};

export const upload = (
  params: Bytes = named('a.txt'),
  data: Bytes = 'hello',
  options: BodyOptions = {},
): Buffer =>
  multipart([filePart(params, data), field('mimeType', 'text/plain')], options);

export const plain = (
  id: string,
  about: string,
  body: Buffer,
  contentType: string = ctOf(),
): MultipartCase => ({
  id,
  about,
  contentType,
  body,
});

export const withRequest = (
  id: string,
  about: string,
  request: RequestShape,
  body: Buffer = upload(),
): MultipartCase => ({
  id,
  about,
  contentType: ctOf(),
  body,
  request,
});

export const ok = upload();
export const fieldsOf = (count: number): Buffer[] =>
  Array.from({ length: count }, (_, i) => field(`f${i}`, 'v'));
export const headerLine = (total: number): string => {
  // "Content-Disposition: form-data; name="file"; filename="<x>.txt"" of exactly `total` bytes
  const fixed = 'Content-Disposition: form-data; name="file"; filename=".txt"'
    .length;
  return `Content-Disposition: form-data; name="file"; filename="${'n'.repeat(total - fixed)}.txt"`;
};
// Shift_JIS for the two characters the cases use (no codec dependency).
export const SJIS: Readonly<Record<string, readonly number[]>> = {
  日: [0x93, 0xfa],
  本: [0x96, 0x7b],
};
export const EUCJP: Readonly<Record<string, readonly number[]>> = {
  日: [0xc6, 0xfc],
  本: [0xcb, 0xdc],
};
export function encodeSjis(text: string): Buffer {
  return Buffer.from([...text].flatMap((c) => SJIS[c] ?? [c.charCodeAt(0)]));
}
export const encodeEucjp = (text: string): Buffer =>
  Buffer.from([...text].flatMap((c) => EUCJP[c] ?? [c.charCodeAt(0)]));
/** Python's str.encode('utf-16'): a BOM, then little-endian. */
export const utf16 = (text: string): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
export const utf16le = (text: string): Buffer => Buffer.from(text, 'utf16le');
// cp037 (EBCDIC) for the ASCII the cases use.
export const CP037: Readonly<Record<string, number>> = Object.fromEntries([
  ...'abcdefghi'.split('').map((c, i) => [c, 0x81 + i]),
  ...'jklmnopqr'.split('').map((c, i) => [c, 0x91 + i]),
  ...'stuvwxyz'.split('').map((c, i) => [c, 0xa2 + i]),
  ...'ABCDEFGHI'.split('').map((c, i) => [c, 0xc1 + i]),
  ...'JKLMNOPQR'.split('').map((c, i) => [c, 0xd1 + i]),
  ...'STUVWXYZ'.split('').map((c, i) => [c, 0xe2 + i]),
  ['.', 0x4b],
  ['/', 0x61],
  ['-', 0x60],
  ['"', 0x7f],
  ['=', 0x7e],
  [';', 0x5e],
  [' ', 0x40],
]);
export const cp037 = (text: string): Buffer =>
  Buffer.from([...text].map((c) => CP037[c] ?? 0x6f));

/** A body whose part names and file name (the quoted values only) are encoded with `encode`. */
export const encodedNames = (encode: (text: string) => Buffer): Buffer =>
  multipart([
    part(
      [
        Buffer.concat([
          latin1('Content-Disposition: form-data; name="'),
          encode('file'),
          latin1('"; filename="'),
          encode('a.txt'),
          latin1('"'),
        ]),
      ],
      'hello',
    ),
    part(
      [
        Buffer.concat([
          latin1('Content-Disposition: form-data; name="'),
          encode('mimeType'),
          latin1('"'),
        ]),
      ],
      'text/plain',
    ),
  ]);

export const nameCase = (
  id: string,
  about: string,
  params: Bytes,
  data: Bytes = 'hello',
): MultipartCase => plain(id, about, upload(params, data));

export const contentWith = (marker: string): Buffer =>
  upload(named('a.txt'), `before${CRLF}--${B}${marker}after`);

/** The request bytes for `token` (REQUEST_TOKEN for the sha1 in the oracle). */
export const rawRequest = (c: MultipartCase, token: string): Buffer => {
  const r = c.request ?? {};
  const framing = r.framing ?? 'length';
  const body =
    framing === 'chunked'
      ? Buffer.concat([
          ...[
            c.body.subarray(0, Math.ceil(c.body.length / 2)),
            c.body.subarray(Math.ceil(c.body.length / 2)),
          ]
            .filter((piece) => piece.length > 0)
            .flatMap((piece) => [
              latin1(`${piece.length.toString(16)}${CRLF}`),
              piece,
              latin1(CRLF),
            ]),
          latin1(`0${CRLF}${CRLF}`),
        ])
      : c.body;
  const declared =
    typeof framing === 'object'
      ? c.body.length + framing.declaredDelta
      : c.body.length;
  const lengthLines =
    framing === 'chunked'
      ? ['Transfer-Encoding: chunked']
      : (r.lengthLines ?? ['Content-Length: {length}']).map((line) =>
          line.replace('{length}', String(declared)),
        );
  const lines = [
    `${r.method ?? 'POST'} ${r.path ?? '/extract'} HTTP/${r.version ?? '1.1'}`,
    ...(r.host === false ? [] : ['Host: test']),
    ...(r.authorizations ?? ['Authorization: Bearer {token}']).map((line) =>
      line.replace('{token}', token),
    ),
    ...(r.contentTypes ?? [c.contentType]).map(
      (value) => `Content-Type: ${value}`,
    ),
    ...lengthLines,
    ...(r.extra ?? []),
  ];
  return Buffer.concat([
    Buffer.from(`${lines.join(CRLF)}${CRLF}${CRLF}`, 'latin1'),
    body,
  ]);
};
