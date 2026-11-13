import {
  ctOf,
  type MultipartCase,
  upload,
  withRequest,
} from './multipart-builders';

// The HTTP-level cases: header quirks and duplicates (w), bodies (x) and the HTTP-layer differences (y) of research.md 16.3 / 16.9.

export const HTTP_CASES: readonly MultipartCase[] = [
  // w: HTTP header quirks and duplicated headers (16.3)
  withRequest('w01', 'two Content-Type lines, the valid one first', {
    contentTypes: [ctOf(), 'text/plain'],
  }),
  withRequest('w02', 'Transfer-Encoding and Content-Length both', {
    extra: ['Transfer-Encoding: chunked'],
  }),
  withRequest('w03', 'Content-Length: +<n>', {
    lengthLines: ['Content-Length: +{length}'],
  }),
  withRequest('w04', 'Content-Length twice, same value', {
    lengthLines: ['Content-Length: {length}', 'Content-Length: {length}'],
  }),
  withRequest('w05', 'Content-Length twice, different values', {
    lengthLines: ['Content-Length: {length}', 'Content-Length: 1'],
  }),
  withRequest('w06', 'folded request header', { extra: ['X-Folded: a', ' b'] }),
  withRequest('w07', 'Content-Length with 30 digits', {
    lengthLines: [`Content-Length: ${'9'.repeat(30)}`],
  }),
  withRequest('w08', 'lower-case bearer', {
    authorizations: ['Authorization: bearer {token}'],
  }),
  withRequest('w09', 'two spaces after Bearer', {
    authorizations: ['Authorization: Bearer  {token}'],
  }),
  withRequest('w10', 'Basic scheme with the token', {
    authorizations: ['Authorization: Basic {token}'],
  }),
  withRequest('w11', 'no Authorization header', { authorizations: [] }),
  withRequest('w12', 'Content-Length: 1e3', {
    lengthLines: ['Content-Length: 1e3'],
  }),
  withRequest('w13', 'two Content-Type lines, an invalid one first', {
    contentTypes: ['text/plain', ctOf()],
  }),
  withRequest('w14', 'two Content-Type lines with different boundaries', {
    contentTypes: [ctOf(), ctOf('other')],
  }),
  withRequest('w15', 'Authorization twice, the valid one first', {
    authorizations: [
      'Authorization: Bearer {token}',
      'Authorization: Bearer wrong',
    ],
  }),
  withRequest('w16', 'Content-Length twice, the second one larger', {
    lengthLines: ['Content-Length: {length}', 'Content-Length: 99999'],
  }),
  withRequest('w17', 'two Content-Type lines, the second one empty', {
    contentTypes: [ctOf(), ''],
  }),
  withRequest('w18', 'Authorization twice, valid then wrong scheme', {
    authorizations: ['Authorization: Bearer {token}', 'Authorization: Basic x'],
  }),
  withRequest('w19', 'Authorization twice, wrong then valid', {
    authorizations: [
      'Authorization: Bearer wrong',
      'Authorization: Bearer {token}',
    ],
  }),
  // x: HTTP-level bodies (16.3)
  withRequest('x01', 'Content-Length: 0, no body', {}, Buffer.alloc(0)),
  withRequest('x02', 'no Content-Type', { contentTypes: [] }),
  withRequest('x03', 'chunked body', { framing: 'chunked' }),
  withRequest(
    'x08',
    'chunked body, raw LF in the file name value',
    { framing: 'chunked' },
    upload('name="file"; filename=a.txt\nX'),
  ),
  withRequest('x09', 'HTTP/1.0 request', { version: '1.0' }),
  withRequest('x10', 'Connection: close request', {
    extra: ['Connection: close'],
  }),
  // y: HTTP-layer differences (16.9); y01-y38 per 22.5 where research.md names them
  withRequest(
    'y01',
    'GET /extract with a token',
    { method: 'GET' },
    Buffer.alloc(0),
  ),
  withRequest('y04', 'PUT /extract with a token', { method: 'PUT' }),
  withRequest(
    'y12',
    'OPTIONS /extract with a token',
    { method: 'OPTIONS' },
    Buffer.alloc(0),
  ),
  withRequest(
    'y14',
    'HEAD /extract with a token',
    { method: 'HEAD' },
    Buffer.alloc(0),
  ),
  withRequest('y15', 'POST /extract/ (trailing slash)', { path: '/extract/' }),
  withRequest('y16', 'Expect: foo', { extra: ['Expect: foo'] }),
  withRequest('y22', 'HTTP/1.1 without Host', { host: false }),
  withRequest('y37', 'Authorization with a trailing space', {
    authorizations: ['Authorization: Bearer {token} '],
  }),
  withRequest('y38', 'Authorization with a trailing tab', {
    authorizations: ['Authorization: Bearer {token}\t'],
  }),
  withRequest('y40', 'Expect twice: 100-continue and foo', {
    extra: ['Expect: 100-continue', 'Expect: foo'],
  }),
];
