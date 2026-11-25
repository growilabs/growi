import {
  B,
  CRLF,
  contentWith,
  ctOf,
  disposition,
  encodeSjis,
  field,
  fieldsOf,
  filePart,
  headerLine,
  latin1,
  type MultipartCase,
  multipart,
  nameCase,
  named,
  ok,
  part,
  plain,
  upload,
  withRequest,
} from './multipart-builders';

// The body-grammar cases: the first set (1-43) and the second and third reviews (e, h, r) of research.md 16.3.

export const BODY_CASES: readonly MultipartCase[] = [
  // 1-43: the first set (16.3)
  plain('01', 'ordinary upload: a.txt and mimeType=text/plain', ok),
  nameCase('02', 'Japanese file name in raw UTF-8', named('日本語の資料.txt')),
  nameCase(
    '03',
    "filename plus filename*=UTF-8'' (the extended one wins)",
    `name="file"; filename="fallback.txt"; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.txt`,
  ),
  nameCase('04', 'unquoted filename', 'name="file"; filename=a.txt'),
  nameCase('05', 'path in the file name (kept)', named('dir/sub/a.txt')),
  nameCase(
    '06',
    'Windows path in the file name (last segment kept)',
    'name="file"; filename="C:\\Users\\x\\a.txt"',
  ),
  nameCase('07', 'empty file name', named('')),
  nameCase(
    '08',
    'escaped quote in the file name',
    'name="file"; filename="a\\"b.txt"',
  ),
  nameCase(
    '09',
    'file name with spaces and semicolon in quotes',
    named('my; file name.txt'),
  ),
  nameCase('10', 'upper-case extension', named('A.TXT')),
  plain('11', 'no mimeType field', multipart([filePart(named('a.txt'))])),
  plain(
    '12',
    'no file part, only mimeType',
    multipart([field('mimeType', 'text/plain')]),
  ),
  plain(
    '13',
    'two file parts',
    multipart([filePart(named('a.txt')), filePart(named('b.txt'))]),
  ),
  plain('14', '`file` as a plain field', multipart([field('file', 'hello')])),
  plain(
    '15',
    'file part without a name',
    multipart([filePart('filename="a.txt"')]),
  ),
  plain('16', 'JSON body', Buffer.from('{"file":"hello"}'), 'application/json'),
  plain(
    '17',
    'broken body: delimiter then garbage',
    latin1(`--${B}${CRLF}garbage-without-headers`),
  ),
  plain('18', 'empty body', Buffer.alloc(0)),
  nameCase('19', '5,000-character file name', named(`${'n'.repeat(5000)}.txt`)),
  nameCase('20', '17 KiB file name', named(`${'n'.repeat(17 * 1024)}.txt`)),
  plain(
    '21',
    'a file sent as a plain field (the generated client today)',
    multipart([field('file', 'hello'), field('mimeType', 'text/plain')]),
  ),
  plain(
    '22',
    '1,000 extra fields',
    multipart([filePart(named('a.txt')), ...fieldsOf(999)]),
  ),
  plain(
    '23',
    '1,001 fields',
    multipart([filePart(named('a.txt')), ...fieldsOf(1001)]),
  ),
  nameCase('24', 'empty file content', named('a.txt'), ''),
  plain(
    '27',
    'mimeType before the file',
    multipart([field('mimeType', 'text/plain'), filePart(named('a.txt'))]),
  ),
  plain(
    '28',
    'Multipart/Form-Data in upper case',
    ok,
    `Multipart/Form-Data; boundary=${B}`,
  ),
  plain(
    '29',
    'no closing delimiter, body ends inside the file',
    multipart([filePart(named('a.txt'), 'hel')], { close: false }),
  ),
  plain(
    '31a',
    'Content-Disposition line of 4,223 bytes',
    multipart([part([headerLine(4223)], 'hello')]),
  ),
  plain(
    '31b',
    'Content-Disposition line of 4,224 bytes',
    multipart([part([headerLine(4224)], 'hello')]),
  ),
  plain(
    '31c',
    'Content-Disposition line of 4,225 bytes',
    multipart([part([headerLine(4225)], 'hello')]),
  ),
  plain(
    '31d',
    'Content-Disposition line of 4,226 bytes',
    multipart([part([headerLine(4226)], 'hello')]),
  ),
  plain(
    '32',
    'eight part headers',
    multipart([
      part(
        [
          disposition(named('a.txt')),
          ...Array.from({ length: 7 }, (_, i) => `X-H${i}: v`),
        ],
        'hello',
      ),
    ]),
  ),
  plain(
    '33',
    'nine part headers',
    multipart([
      part(
        [
          disposition(named('a.txt')),
          ...Array.from({ length: 8 }, (_, i) => `X-H${i}: v`),
        ],
        'hello',
      ),
    ]),
  ),
  plain(
    '34',
    '2,500 part headers',
    multipart([
      part(
        [
          disposition(named('a.txt')),
          ...Array.from({ length: 2499 }, (_, i) => `X-H${i}: v`),
        ],
        'hello',
      ),
    ]),
  ),
  nameCase('35', '90 KiB file name', named(`${'n'.repeat(90 * 1024)}.txt`)),
  plain(
    '36',
    'part header name with a space before the colon',
    multipart([
      part(
        ['Content-Disposition : form-data; name="file"; filename="a.txt"'],
        'hello',
      ),
    ]),
  ),
  plain(
    '38',
    'preamble text before the first delimiter',
    upload(named('a.txt'), 'hello', { preamble: 'This is a preamble.\r\n' }),
  ),
  plain(
    '39',
    'epilogue after the closing delimiter',
    upload(named('a.txt'), 'hello', { epilogue: 'trailing epilogue text' }),
  ),
  nameCase(
    '40',
    'filename* with %0D%0A',
    `name="file"; filename*=UTF-8''a%0D%0Ab.txt`,
  ),
  plain(
    '41',
    'two mimeType fields (the last wins)',
    multipart([
      filePart(named('a.zzz')),
      field('mimeType', 'application/pdf'),
      field('mimeType', 'text/plain'),
    ]),
  ),
  nameCase(
    '42',
    'raw cp932 file name',
    Buffer.concat([
      latin1('name="file"; filename="'),
      encodeSjis('日本'),
      latin1('.txt"'),
    ]),
  ),
  plain(
    '43',
    'Content-Transfer-Encoding: base64 (not decoded)',
    multipart([
      part(
        [disposition(named('a.txt')), 'Content-Transfer-Encoding: base64'],
        'aGVsbG8=',
      ),
    ]),
  ),
  withRequest('37', 'Content-Length 20 bytes below the body', {
    framing: { declaredDelta: -20 },
  }),
  // e: the second review (16.3)
  plain(
    'e01',
    'body starts with CRLF',
    upload(named('a.txt'), 'hello', { preamble: CRLF }),
  ),
  plain(
    'e02',
    'body starts with LF',
    upload(named('a.txt'), 'hello', { preamble: '\n' }),
  ),
  plain(
    'e02b',
    "CRLF and a preamble holding '-'",
    upload(named('a.txt'), 'hello', { preamble: `${CRLF}pre-amble${CRLF}` }),
  ),
  plain(
    'e03',
    'two spaces after the first delimiter',
    Buffer.concat([
      latin1(`--${B}  ${CRLF}`),
      filePart(named('a.txt')),
      latin1(`${CRLF}--${B}--${CRLF}`),
    ]),
  ),
  plain(
    'e06',
    'part headers end with LF only',
    Buffer.concat([
      latin1(
        `--${B}${CRLF}Content-Disposition: form-data; ${named('a.txt')}\n\n`,
      ),
      latin1(`hello${CRLF}--${B}--${CRLF}`),
    ]),
  ),
  plain(
    'e07a',
    'content holds "\\r\\n--boundary" then XYZ',
    contentWith('XYZ'),
  ),
  plain(
    'e07b',
    'content holds "\\r\\n--boundary" then a letter',
    contentWith('Q'),
  ),
  plain(
    'e10',
    'part header line without a colon',
    multipart([part([disposition(named('a.txt')), 'NoColonHere'], 'hello')]),
  ),
  plain(
    'e11',
    'folded part header',
    multipart([
      part([disposition('name="file";'), ' filename="a.txt"'], 'hello'),
    ]),
  ),
  plain(
    'e12',
    'part without headers, then the file',
    multipart([part([], 'orphan'), filePart(named('a.txt'))]),
  ),
  plain(
    'e15b',
    '5,000-character boundary',
    upload(named('a.txt'), 'hello', { boundary: 'b'.repeat(5000) }),
    ctOf('b'.repeat(5000)),
  ),
  plain(
    'e16',
    'nested multipart/mixed content',
    upload(
      named('a.txt'),
      `--inner${CRLF}Content-Type: text/plain${CRLF}${CRLF}nested text${CRLF}--inner--`,
    ),
  ),
  plain(
    'e19',
    'empty boundary',
    upload(named('a.txt'), 'hello', { boundary: '' }),
    'multipart/form-data; boundary=""',
  ),
  plain(
    'e20',
    'upper-case BOUNDARY=',
    ok,
    `multipart/form-data; BOUNDARY=${B}`,
  ),
  plain(
    'e22',
    'raw CRLF inside a quoted file name',
    multipart([
      part(
        [
          `Content-Disposition: form-data; name="file"; filename="a${CRLF}b.txt"`,
        ],
        'hello',
      ),
    ]),
  ),
  plain(
    'e23',
    'epilogue holding another delimiter',
    upload(named('a.txt'), 'hello', { epilogue: `--${B}${CRLF}junk` }),
  ),
  plain(
    'e26',
    'charset=utf-8 in the Content-Type',
    ok,
    ctOf(B, '; charset=utf-8'),
  ),
  plain(
    'e27',
    'part header with an empty name',
    multipart([part([disposition(named('a.txt')), ': value'], 'hello')]),
  ),
  plain('e28', 'quoted boundary', ok, `multipart/form-data; boundary="${B}"`),
  plain(
    'e29',
    'spaces around boundary=',
    ok,
    `multipart/form-data;  boundary=${B} `,
  ),
  plain('e30', 'extra parameter after the boundary', ok, ctOf(B, '; foo=bar')),
  plain(
    'e33',
    '50,000 spaces after the first delimiter',
    Buffer.concat([
      latin1(`--${B}${' '.repeat(50_000)}${CRLF}`),
      filePart(named('a.txt')),
      latin1(`${CRLF}--${B}--${CRLF}`),
    ]),
  ),
  plain(
    'h1',
    'no blank line after the part headers',
    latin1(
      `--${B}${CRLF}Content-Disposition: form-data; ${named('a.txt')}${CRLF}--${B}--${CRLF}`,
    ),
  ),
  plain(
    'h3',
    'closing delimiter right after the part headers',
    latin1(
      `--${B}${CRLF}Content-Disposition: form-data; ${named('a.txt')}${CRLF}${CRLF}--${B}--${CRLF}`,
    ),
  ),
  // r: the third review (16.3)
  plain(
    'r01',
    'body starts with LF and a preamble line',
    upload(named('a.txt'), 'hello', { preamble: '\npreamble line\n' }),
  ),
  plain(
    'r02',
    'body starts with CRLF CRLF',
    upload(named('a.txt'), 'hello', { preamble: `${CRLF}${CRLF}` }),
  ),
  plain(
    'r03',
    'body starts with CR only',
    upload(named('a.txt'), 'hello', { preamble: '\r' }),
  ),
  plain(
    'r05',
    'body starts with CRLF and a text line',
    upload(named('a.txt'), 'hello', { preamble: `${CRLF}some text${CRLF}` }),
  ),
  nameCase(
    'r08',
    'raw LF inside an unquoted value',
    'name="file"; filename=a.txt\nX',
  ),
  plain(
    'r12',
    'Content-Disposition: attachment; name=...',
    multipart([
      part([`Content-Disposition: attachment; ${named('a.txt')}`], 'hello'),
    ]),
  ),
  plain(
    'r14',
    'two Content-Disposition lines (file, then mimeType)',
    multipart([
      part(
        [disposition(named('a.txt')), disposition('name="mimeType"')],
        'hello',
      ),
    ]),
  ),
  plain(
    'r16',
    'second part with a name parameter but no value',
    multipart([
      filePart(named('a.txt')),
      part(['Content-Disposition: form-data; name'], 'v'),
    ]),
  ),
  plain(
    'r20',
    'content holds "\\r\\n--boundary\\r" then a letter',
    contentWith('\rX'),
  ),
  plain(
    'r21',
    'content holds "\\r\\n--boundary-" then a letter',
    contentWith('-X'),
  ),
  plain(
    'r23',
    'content holds "\\r\\n--boundary " then text',
    contentWith(' text'),
  ),
  plain(
    'r31',
    'boundary= twice (the last wins)',
    upload(named('a.txt'), 'hello', { boundary: 'second' }),
    `multipart/form-data; boundary=first; boundary=second`,
  ),
  plain(
    'r34',
    '253-character boundary',
    upload(named('a.txt'), 'hello', { boundary: 'c'.repeat(253) }),
    ctOf('c'.repeat(253)),
  ),
  nameCase('r36', 'file name ending with /', named('a.txt/')),
  nameCase(
    'r37',
    'NUL in the file name through filename*',
    `name="file"; filename*=UTF-8''a%00b.txt`,
  ),
  plain('r41', 'content holds "\\r\\n--boundary\\n"', contentWith('\nX')),
];
