import { errorOf, postFile } from '../../src/http/spec-support/extract-client';
import { useBlackboxService } from './blackbox-service';

// Black box (research.md 22.7 `hygiene`): Req 1.8, an error answer carries
// neither the file's content nor its name. Python test_e2e_http.py
// TestHygieneOverHttp, response side; the log side of the same tests needs the
// service's log and is in src/http/request-log.integ.ts.

const service = useBlackboxService();

const CONTENT_MARKER = 'SECRET-CONTENT-MARKER-7f3a';
const FILE_NAME_MARKER = 'SECRET-FILE-NAME-MARKER-91c2';

const CASES: Readonly<Record<string, readonly [Buffer, string, number]>> = {
  'corrupt-docx': [
    Buffer.from(`PK\x03\x04${CONTENT_MARKER}`, 'latin1'),
    `${FILE_NAME_MARKER}.docx`,
    422,
  ],
  'corrupt-pdf': [
    Buffer.from(`%PDF-1.4\n${CONTENT_MARKER}`, 'latin1'),
    `${FILE_NAME_MARKER}.pdf`,
    422,
  ],
  'corrupt-xlsx': [
    Buffer.from(`PK\x03\x04${CONTENT_MARKER}`, 'latin1'),
    `${FILE_NAME_MARKER}.xlsx`,
    422,
  ],
  unsupported: [Buffer.from(CONTENT_MARKER), `${FILE_NAME_MARKER}.msg`, 400],
  'unknown-extension': [
    Buffer.from(CONTENT_MARKER),
    `${FILE_NAME_MARKER}.zzz`,
    400,
  ],
};

describe('error answers', () => {
  it.each(
    Object.keys(CASES),
  )('%s: carries neither content nor file name', async (name) => {
    const row = CASES[name];
    if (row === undefined) throw new Error(`no case ${name}`);
    const [data, fileName, status] = row;
    const { url, token } = service();

    const answer = await postFile(url, fileName, data, { token });

    expect(answer.status).toBe(status);
    expect(answer.text).not.toContain(CONTENT_MARKER);
    expect(answer.text).not.toContain(FILE_NAME_MARKER);
    expect(errorOf(answer).keys).toEqual(['code', 'message']);
  });
});
