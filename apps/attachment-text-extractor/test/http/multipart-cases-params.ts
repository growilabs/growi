import {
  B,
  CRLF,
  cp037,
  ctOf,
  encodedNames,
  encodeEucjp,
  encodeSjis,
  field,
  fieldsOf,
  filePart,
  latin1,
  type MultipartCase,
  multipart,
  nameCase,
  named,
  ok,
  plain,
  upload,
  utf16,
  utf16le,
} from './multipart-builders';

// The parameter and charset cases: the root-cause study (d), the fourth review (m) and the request charset (v) of research.md 16.3.

const UNDICI_BOUNDARY = '----formdata-undici-012345678901';

/** The bytes undici's FormData serialization writes for a file and an optional mimeType field. */
const undiciBody = (
  fileName: string,
  content: string,
  mimeType?: string,
): Buffer =>
  latin1(
    [
      `--${UNDICI_BOUNDARY}${CRLF}Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}Content-Type: application/octet-stream${CRLF}${CRLF}${content}${CRLF}`,
      mimeType === undefined
        ? ''
        : `--${UNDICI_BOUNDARY}${CRLF}Content-Disposition: form-data; name="mimeType"${CRLF}${CRLF}${mimeType}${CRLF}`,
      `--${UNDICI_BOUNDARY}--${CRLF}`,
    ].join(''),
  );

export const PARAM_CASES: readonly MultipartCase[] = [
  // d: the root-cause study (16.3)
  nameCase(
    'd01',
    'filename*0= and filename*1= (plain)',
    'name="file"; filename*0="a"; filename*1=".txt"',
  ),
  nameCase(
    'd02',
    "filename*0*=UTF-8'' and filename*1*=",
    `name="file"; filename*0*=UTF-8''%E6%97%A5; filename*1*=%E6%9C%AC.txt`,
  ),
  nameCase(
    'd03',
    'continuation numbers out of order',
    'name="file"; filename*1=".txt"; filename*0="xA"',
  ),
  nameCase(
    'd07',
    'continuations next to a plain filename',
    'name="file"; filename="plain.zzz"; filename*0="a"; filename*1=".txt"',
  ),
  nameCase(
    'd08',
    'three continuations',
    'name="file"; filename*0="a"; filename*1="b"; filename*2=".txt"',
  ),
  nameCase(
    'd09',
    'continuation and extended forms of different names',
    'name="file"; filename*0="x"; filename*1=".txt"; other*=UTF-8\'\'z.pdf',
  ),
  nameCase(
    'd10',
    'filename* then filename; text content under b.pdf',
    `name="file"; filename*=UTF-8''b.pdf; filename="a.txt"`,
  ),
  plain(
    'd11',
    "name*=UTF-8''file",
    multipart([
      filePart(`name*=UTF-8''file; filename="a.txt"`),
      field('mimeType', 'text/plain'),
    ]),
  ),
  plain(
    'd12',
    'charset=shift_jis and a raw Shift_JIS file name',
    upload(
      Buffer.concat([
        latin1('name="file"; filename="'),
        encodeSjis('日本'),
        latin1('.txt"'),
      ]),
    ),
    ctOf(B, '; charset=shift_jis'),
  ),
  nameCase(
    'd13',
    'a parameter named __proto__',
    'name="file"; __proto__="x"; filename="a.txt"',
  ),
  plain(
    'd14',
    'a part named __proto__',
    multipart([filePart(named('a.txt')), field('__proto__', 'x')]),
  ),
  plain(
    'd15',
    'body cut after the file part ended (no closing delimiter)',
    multipart([filePart(named('a.txt')), field('mimeType', 'text/plain')], {
      close: false,
    }),
  ),
  plain(
    'd16',
    'body cut right after the delimiter that ends the file',
    Buffer.concat([
      latin1(`--${B}${CRLF}`),
      filePart(named('a.txt')),
      latin1(`${CRLF}--${B}`),
    ]),
  ),
  plain(
    'd17',
    'body cut inside the headers of the part after the file',
    Buffer.concat([
      latin1(`--${B}${CRLF}`),
      filePart(named('a.txt')),
      latin1(`${CRLF}--${B}${CRLF}Content-Disp`),
    ]),
  ),
  plain(
    'd18',
    'body cut inside the file',
    Buffer.concat([latin1(`--${B}${CRLF}`), filePart(named('a.txt'), 'hel')]),
  ),
  plain(
    'd20',
    'two mimeType fields, the first one a valid hint',
    multipart([
      filePart(named('a.zzz')),
      field('mimeType', 'text/plain'),
      field('mimeType', 'application/x-unknown'),
    ]),
  ),
  nameCase(
    'd24',
    'UNC path in the file name',
    'name="file"; filename="\\\\server\\share\\a.txt"',
  ),
  plain(
    'd26',
    '1,000 fields',
    multipart([filePart(named('a.txt')), ...fieldsOf(1000)]),
  ),
  plain(
    'd27',
    '1,001 fields with the file first',
    multipart([filePart(named('a.txt')), ...fieldsOf(1001)]),
  ),
  nameCase(
    'd29',
    'filename*= with a language tag',
    `name="file"; filename*=UTF-8'ja'%E6%97%A5.txt`,
  ),
  plain(
    'd30',
    "boundary*=''<boundary>",
    ok,
    `multipart/form-data; boundary*=''${B}`,
  ),
  plain(
    'd31',
    'a 1 MiB field',
    multipart([
      filePart(named('a.txt')),
      field('extra', 'v'.repeat(1024 * 1024)),
    ]),
  ),
  plain(
    'd32',
    'a 1 MiB + 1 field',
    multipart([
      filePart(named('a.txt')),
      field('extra', 'v'.repeat(1024 * 1024 + 1)),
    ]),
  ),
  // d33: bodies as undici's FormData writes them (Node's fetch), with a fixed boundary
  plain(
    'd33',
    'undici FormData body: text content under a .pdf name',
    undiciBody('report.pdf', 'plain text, not a pdf'),
    ctOf(UNDICI_BOUNDARY),
  ),
  plain(
    'd33b',
    'undici FormData body: .pdf name with mimeType=application/pdf',
    undiciBody('report.pdf', 'plain text, not a pdf', 'application/pdf'),
    ctOf(UNDICI_BOUNDARY),
  ),
  plain(
    'd33c',
    'undici FormData body: a.txt with mimeType=text/plain',
    undiciBody('a.txt', 'hello from undici', 'text/plain'),
    ctOf(UNDICI_BOUNDARY),
  ),
  nameCase(
    'd34',
    'filename* without a charset',
    'name="file"; filename*=\'\'a.txt',
  ),
  nameCase(
    'd35',
    'filename* with one quote only',
    'name="file"; filename*=UTF-8\'a.txt',
  ),
  nameCase(
    'd36',
    'filename*= and filename*0= mixed',
    `name="file"; filename*=UTF-8''a.txt; filename*0="b.txt"`,
  ),
  plain(
    'd37',
    "boundary*=UTF-8''a%0D%0Ab (CR and LF in the boundary)",
    upload(named('a.txt'), 'hello', { boundary: 'a\r\nb' }),
    "multipart/form-data; boundary*=UTF-8''a%0D%0Ab",
  ),
  nameCase('d38', 'backslash outside quotes', 'name="file"; filename=a\\b.txt'),
  // m: the fourth review (16.3); only the ones research.md describes
  plain(
    'm09a',
    '70-character boundary',
    upload(named('a.txt'), 'hello', { boundary: 'm'.repeat(70) }),
    ctOf('m'.repeat(70)),
  ),
  plain(
    'm09b',
    '252-character boundary',
    upload(named('a.txt'), 'hello', { boundary: 'm'.repeat(252) }),
    ctOf('m'.repeat(252)),
  ),
  plain(
    'm09c',
    '254-character boundary',
    upload(named('a.txt'), 'hello', { boundary: 'm'.repeat(254) }),
    ctOf('m'.repeat(254)),
  ),
  plain(
    'm09d',
    '1,000-character boundary',
    upload(named('a.txt'), 'hello', { boundary: 'm'.repeat(1000) }),
    ctOf('m'.repeat(1000)),
  ),
  nameCase(
    'm21',
    'filename*0= then filename*= (mixed, other order)',
    `name="file"; filename*0="b.txt"; filename*=UTF-8''a.txt`,
  ),
  plain(
    'm58',
    'charset=utf-16, names in ASCII',
    ok,
    ctOf(B, '; charset=utf-16'),
  ),
  plain(
    'm59',
    'charset=iso-8859-1, file name in UTF-8',
    upload(named('日本.txt')),
    ctOf(B, '; charset=iso-8859-1'),
  ),
  plain(
    'm60',
    'unknown charset, file name in UTF-8',
    upload(named('日本.txt')),
    ctOf(B, '; charset=x-nope'),
  ),
  plain('m61', 'charset=cp037, names in ASCII', ok, ctOf(B, '; charset=cp037')),
  plain(
    'm64',
    "boundary*=''a%0Ab (LF only in the boundary)",
    upload(named('a.txt'), 'hello', { boundary: 'a\nb' }),
    "multipart/form-data; boundary*=''a%0Ab",
  ),
  // v: the fifth review, the request charset (16.3, 7.4 3)
  plain(
    'v01',
    'names encoded in UTF-16 under charset=utf-16',
    encodedNames(utf16),
    ctOf(B, '; charset=utf-16'),
  ),
  plain(
    'v02',
    'names encoded in cp037 under charset=cp037',
    encodedNames(cp037),
    ctOf(B, '; charset=cp037'),
  ),
  plain(
    'v03',
    'charset=shift_jis, raw Shift_JIS file name',
    upload(
      Buffer.concat([
        latin1('name="file"; filename="'),
        encodeSjis('日本'),
        latin1('.txt"'),
      ]),
    ),
    ctOf(B, '; charset=shift_jis'),
  ),
  plain('v04', 'charset=utf-8, ASCII names', ok, ctOf(B, '; charset=utf-8')),
  plain(
    'v05',
    'charset=latin-1, ASCII names',
    ok,
    ctOf(B, '; charset=latin-1'),
  ),
  plain(
    'v06',
    'charset=us-ascii, file name in UTF-8',
    upload(named('日本.txt')),
    ctOf(B, '; charset=us-ascii'),
  ),
  plain(
    'v07',
    'charset=utf-7, file name a.+AHQAeAB0-',
    upload(named('a.+AHQAeAB0-')),
    ctOf(B, '; charset=utf-7'),
  ),
  plain('v08', 'charset=ascii, ASCII names', ok, ctOf(B, '; charset=ascii')),
  plain(
    'v09',
    'charset=UTF-8 in upper case, ASCII names',
    ok,
    ctOf(B, '; charset=UTF-8'),
  ),
  plain('v10', 'charset=punycode', ok, ctOf(B, '; charset=punycode')),
  plain(
    'v11',
    'charset=utf-8; charset=utf-16',
    ok,
    ctOf(B, '; charset=utf-8; charset=utf-16'),
  ),
  plain('v12', 'charset=cp1252, ASCII names', ok, ctOf(B, '; charset=cp1252')),
  plain('v13', 'charset=euc-jp, ASCII names', ok, ctOf(B, '; charset=euc-jp')),
  plain('v14', 'quoted charset="utf-8"', ok, ctOf(B, '; charset="utf-8"')),
  plain(
    'v15',
    'charset=cp1252, byte 0x80 in the file name',
    upload(
      Buffer.concat([
        latin1('name="file"; filename="a'),
        Buffer.from([0x80]),
        latin1('.txt"'),
      ]),
    ),
    ctOf(B, '; charset=cp1252'),
  ),
  plain(
    'v16',
    'names encoded in UTF-16-LE under charset=utf-16-le',
    encodedNames(utf16le),
    ctOf(B, '; charset=utf-16-le'),
  ),
  plain(
    'v17',
    'charset=iso-8859-1, ASCII names',
    ok,
    ctOf(B, '; charset=iso-8859-1'),
  ),
  plain(
    'v18',
    'charset=utf-16 before the boundary, ASCII names',
    ok,
    `multipart/form-data; charset=utf-16; boundary=${B}`,
  ),
  plain(
    'v19',
    'charset=euc-jp, raw EUC-JP file name',
    upload(
      Buffer.concat([
        latin1('name="file"; filename="'),
        encodeEucjp('日本'),
        latin1('.txt"'),
      ]),
    ),
    ctOf(B, '; charset=euc-jp'),
  ),
  plain(
    'v20',
    'charset=iso-2022-jp, raw ISO-2022-JP file name',
    upload(
      Buffer.concat([
        latin1('name="file"; filename="'),
        Buffer.from([
          0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x1b, 0x28, 0x42,
        ]),
        latin1('.txt"'),
      ]),
    ),
    ctOf(B, '; charset=iso-2022-jp'),
  ),
];
