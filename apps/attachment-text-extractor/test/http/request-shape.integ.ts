import {
  type Answer,
  errorOf,
  extractedOf,
  postBody,
  postFile,
  postParts,
} from '../../src/http/spec-support/extract-client';
import {
  multipartBody,
  multipartContentType,
  SPEC_BOUNDARY,
} from '../../src/http/spec-support/multipart';
import { useBlackboxService } from './blackbox-service';

// Black box (research.md 22.7 `request-shape`): what a request must look like.
// Python test_e2e_http.py TestRequestShapeOverHttp, the invalid-upload rows of
// test_extract_router.py, and 17.10's request table: the field names `file`
// and `mimeType`, `file` required, `mimeType` optional. The `mimeType` name is
// only proven by a pair whose answer depends on reading the hint (17.10).

const service = useBlackboxService();
const MARKER = 'SECRET-FILE-CONTENT-MARKER';

const expectInvalidUpload = (answer: Answer, notEchoed?: string): void => {
  expect(answer.status, answer.text).toBe(422);
  expect(errorOf(answer).keys).toEqual(['code', 'message']);
  expect(errorOf(answer).code).toBe('extraction_failed');
  expect(Buffer.byteLength(answer.text)).toBeLessThan(512);
  if (notEchoed !== undefined) {
    expect(answer.text).not.toContain(notEchoed);
  }
};

const expectUnsupported = (answer: Answer): void => {
  expect(answer.status, answer.text).toBe(400);
  expect(errorOf(answer).code).toBe('unsupported_format');
};

describe('the file part', () => {
  it('a body without `file` is 422 extraction_failed', async () => {
    const { url, token } = service();

    const answer = await postParts(
      url,
      [{ name: 'mimeType', filename: null, data: 'text/plain' }],
      { token },
    );

    expectInvalidUpload(answer);
  });

  it('`file` sent as a plain field (no file name) is 422 and not echoed', async () => {
    const { url, token } = service();

    const answer = await postParts(
      url,
      [{ name: 'file', filename: null, data: MARKER }],
      { token },
    );

    expectInvalidUpload(answer, MARKER);
  });

  it('a 2 MiB `file` sent as a plain field is 422 and not echoed', async () => {
    const { url, token } = service();
    const data = MARKER.repeat(Math.floor((2 * 1024 * 1024) / MARKER.length));

    const answer = await postParts(
      url,
      [{ name: 'file', filename: null, data }],
      { token },
    );

    expectInvalidUpload(answer, MARKER);
  });

  it('two file parts are 422', async () => {
    const { url, token } = service();

    const answer = await postParts(
      url,
      [
        { name: 'file', filename: 'a.txt', data: 'a' },
        { name: 'file', filename: 'b.txt', data: 'b' },
      ],
      { token },
    );

    expectInvalidUpload(answer);
  });

  it('a body that is not multipart is 422 and not echoed', async () => {
    const { url, token } = service();

    const answer = await postBody(
      url,
      JSON.stringify({ file: MARKER }),
      'application/json',
      { token },
    );

    expectInvalidUpload(answer, MARKER);
  });

  it('a broken multipart body is 422', async () => {
    const { url, token } = service();

    const answer = await postBody(
      url,
      '--xyz\r\ngarbage-without-headers',
      'multipart/form-data; boundary=xyz',
      { token },
    );

    expectInvalidUpload(answer);
  });

  it('a part header over the 4,224-byte line limit is 422 and the name is not echoed', async () => {
    const { url, token } = service();
    const name = `SECRET-FILENAME-MARKER${'n'.repeat(5000)}.txt`;

    expectInvalidUpload(
      await postFile(url, name, 'payload', { token }),
      'SECRET-FILENAME-MARKER',
    );
  });

  it('a 1,004-character file name is accepted', async () => {
    const { url, token } = service();

    const answer = await postFile(url, `${'n'.repeat(1000)}.txt`, 'payload', {
      token,
    });

    expect(extractedOf(answer).pages[0]?.content).toBe('payload');
  });

  it('an empty file name is not a server error: no extension, so unsupported', async () => {
    const { url, token } = service();

    expectUnsupported(await postFile(url, '', 'text', { token }));
  });
});

describe('empty files', () => {
  it('an empty text file is one empty element', async () => {
    const { url, token } = service();

    const extracted = extractedOf(
      await postFile(url, 'empty.txt', '', { token }),
    );

    expect(extracted.pages).toEqual([
      { pageNumber: null, label: null, content: '' },
    ]);
    expect(extracted.extractedCharacters).toBe(0);
  });

  it.each([
    'empty.pdf',
    'empty.docx',
    'empty.xlsx',
  ])('%s is a malformed 422', async (name) => {
    const { url, token } = service();

    const answer = await postFile(url, name, '', { token });

    expect(answer.status).toBe(422);
    expect(errorOf(answer).code).toBe('extraction_failed');
    expect(errorOf(answer).message.split(':', 1)[0]).toBe('malformed');
  });

  it('an empty file with an unknown extension is unsupported', async () => {
    const { url, token } = service();

    expectUnsupported(await postFile(url, 'empty.zzz', '', { token }));
  });
});

describe('the mimeType field (17.10)', () => {
  it('`mimeType` decides a file whose extension is unknown', async () => {
    const { url, token } = service();

    const answer = await postFile(url, 'blob.unknown', 'hello extractor\n', {
      token,
      mimeType: 'text/plain',
    });

    expect(extractedOf(answer).mimeType).toBe('text/plain');
  });

  it('without `mimeType` the same file is 400 unsupported_format', async () => {
    const { url, token } = service();

    expectUnsupported(
      await postFile(url, 'blob.unknown', 'hello extractor\n', { token }),
    );
  });

  it.each([
    'mime_type',
    'mimetype',
    'MimeType',
  ])('a hint under the name `%s` is not read', async (field) => {
    const { url, token } = service();

    const answer = await postParts(
      url,
      [
        { name: 'file', filename: 'blob.unknown', data: 'hello extractor\n' },
        { name: field, filename: null, data: 'text/plain' },
      ],
      { token },
    );

    expectUnsupported(answer);
  });

  it('`mimeType` may be left out: the extension decides', async () => {
    const { url, token } = service();

    expect(
      extractedOf(await postFile(url, 'a.txt', 'hello extractor\n', { token }))
        .mimeType,
    ).toBe('text/plain');
  });

  it('an empty `mimeType` means no hint: the extension still decides', async () => {
    const { url, token } = service();

    expect(
      extractedOf(
        await postFile(url, 'a.txt', 'hello', { token, mimeType: '' }),
      ).mimeType,
    ).toBe('text/plain');
  });

  it('an empty `mimeType` on an unknown extension is 400', async () => {
    const { url, token } = service();

    expectUnsupported(
      await postFile(url, 'blob.unknown', 'hello', { token, mimeType: '' }),
    );
  });

  it('the hint wins over the extension: a.txt sent as application/pdf is a malformed PDF', async () => {
    const { url, token } = service();

    const answer = await postFile(url, 'a.txt', 'hello extractor\n', {
      token,
      mimeType: 'application/pdf',
    });

    expect(answer.status).toBe(422);
    expect(errorOf(answer).code).toBe('extraction_failed');
  });

  it('`mimeType` sent as a second file part is 422 (one file at most)', async () => {
    const { url, token } = service();

    const answer = await postBody(
      url,
      multipartBody([
        { name: 'file', filename: 'a.txt', data: 'hello' },
        { name: 'mimeType', filename: 'hint.txt', data: 'text/plain' },
      ]),
      multipartContentType(SPEC_BOUNDARY),
      { token },
    );

    expectInvalidUpload(answer);
  });
});
