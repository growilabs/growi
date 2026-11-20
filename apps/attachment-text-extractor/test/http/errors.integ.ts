import {
  type Answer,
  errorOf,
  postFile,
} from '../../src/http/spec-support/extract-client';
import {
  buildCorruptPdf,
  buildDeeplyNestedDocx,
  buildEncryptedDocx,
  buildEncryptedPptx,
  buildEncryptedXlsx,
  buildOverCellLimitXlsx,
  buildUserPasswordPdf,
  buildZipBombDocx,
} from '../fixtures';
import { useBlackboxService } from './blackbox-service';

// Black box (research.md 22.7 `errors`): the rows of the error table a default
// service reaches from a document alone (Req 1.3). Python test_e2e_http.py
// TestErrorTableOverHttp; its three 401 rows are in auth.integ.ts. Rows that
// need other settings or a stand-in child are in src/http/extract-limits.integ.ts.

const service = useBlackboxService();

interface ErrorRow {
  readonly data: () => Uint8Array | string;
  readonly fileName: string;
  readonly status: number;
  readonly code: string;
  /** The failure kind the message starts with ("<kind>: <fixed text>"). */
  readonly kind: string;
}

const ERROR_ROWS: Readonly<Record<string, ErrorRow>> = {
  'msg-is-unsupported': {
    data: () => Buffer.from('\xd0\xcf\x11\xe0 outlook message', 'latin1'),
    fileName: 'mail.msg',
    status: 400,
    code: 'unsupported_format',
    kind: 'unsupported',
  },
  'unknown-extension': {
    data: () => 'whatever',
    fileName: 'data.zzz',
    status: 400,
    code: 'unsupported_format',
    kind: 'unsupported',
  },
  'no-extension': {
    data: () => 'whatever',
    fileName: 'README',
    status: 400,
    code: 'unsupported_format',
    kind: 'unsupported',
  },
  'encrypted-docx': {
    data: buildEncryptedDocx,
    fileName: 'a.docx',
    status: 422,
    code: 'file_encrypted',
    kind: 'encrypted',
  },
  'encrypted-xlsx': {
    data: buildEncryptedXlsx,
    fileName: 'a.xlsx',
    status: 422,
    code: 'file_encrypted',
    kind: 'encrypted',
  },
  'encrypted-pptx': {
    data: buildEncryptedPptx,
    fileName: 'a.pptx',
    status: 422,
    code: 'file_encrypted',
    kind: 'encrypted',
  },
  'user-password-pdf': {
    data: buildUserPasswordPdf,
    fileName: 'a.pdf',
    status: 422,
    code: 'file_encrypted',
    kind: 'encrypted',
  },
  'corrupt-pdf': {
    data: buildCorruptPdf,
    fileName: 'a.pdf',
    status: 422,
    code: 'extraction_failed',
    kind: 'malformed',
  },
  'corrupt-docx': {
    data: () => Buffer.from('PK\x03\x04 not really a zip', 'latin1'),
    fileName: 'a.docx',
    status: 422,
    code: 'extraction_failed',
    kind: 'malformed',
  },
  'not-a-pdf': {
    data: () => 'plain text with a pdf name',
    fileName: 'a.pdf',
    status: 422,
    code: 'extraction_failed',
    kind: 'malformed',
  },
  'deeply-nested-docx': {
    data: () => buildDeeplyNestedDocx(),
    fileName: 'a.docx',
    status: 422,
    code: 'resource_limit_exceeded',
    kind: 'limit_exceeded',
  },
  'xlsx-over-cell-limit': {
    data: buildOverCellLimitXlsx,
    fileName: 'a.xlsx',
    status: 422,
    code: 'resource_limit_exceeded',
    kind: 'limit_exceeded',
  },
  'zip-bomb-docx': {
    data: buildZipBombDocx,
    fileName: 'a.docx',
    status: 422,
    code: 'resource_limit_exceeded',
    kind: 'limit_exceeded',
  },
};

const expectError = (
  answer: Answer,
  row: Omit<ErrorRow, 'data' | 'fileName'>,
): void => {
  expect(answer.status, answer.text).toBe(row.status);
  const body = errorOf(answer);
  expect(body.keys).toEqual(['code', 'message']);
  expect(body.code).toBe(row.code);
  expect(body.message.split(':', 1)[0]).toBe(row.kind);
};

describe('error table rows over HTTP', () => {
  it.each(
    Object.keys(ERROR_ROWS),
  )('%s gives its status, code and kind', async (name) => {
    const row = ERROR_ROWS[name];
    if (row === undefined) throw new Error(`no row ${name}`);
    const { url, token } = service();

    expectError(await postFile(url, row.fileName, row.data(), { token }), row);
  }, 60_000);

  it('a failure does not spoil the next request', async () => {
    const { url, token } = service();

    expect(
      (await postFile(url, 'a.pdf', buildCorruptPdf(), { token })).status,
    ).toBe(422);
    expect(
      (await postFile(url, 'a.txt', 'still serving', { token })).status,
    ).toBe(200);
  });
});
