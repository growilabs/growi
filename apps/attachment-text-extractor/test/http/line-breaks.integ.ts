import {
  extractedOf,
  postFile,
} from '../../src/http/spec-support/extract-client';
import { buildDocx, buildJapaneseLinesPdf } from '../fixtures';
import { useBlackboxService } from './blackbox-service';

// Black box (research.md 22.7 `line-breaks`): Req 2.5, only the PDF route closes
// a line break between Japanese characters; a break the author typed stays.
// Python test_e2e_http.py TestLineBreaksOverHttp.

const service = useBlackboxService();

const firstContent = async (
  fileName: string,
  data: Uint8Array | string,
): Promise<string> => {
  const { url, token } = service();
  return (
    extractedOf(await postFile(url, fileName, data, { token })).pages[0]
      ?.content ?? ''
  );
};

describe('line breaks between Japanese characters', () => {
  it('PDF closes a break between two Japanese lines', async () => {
    const content = await firstContent(
      'j.pdf',
      buildJapaneseLinesPdf(['日本', '語です']),
    );

    expect(content.trim()).toBe('日本語です');
  });

  it('PDF keeps a break between Japanese and ASCII', async () => {
    const content = await firstContent(
      'j.pdf',
      buildJapaneseLinesPdf(['日本', 'ABC']),
    );

    expect(content).toContain('日本\nABC');
  });

  it("TXT keeps the author's break between Japanese characters", async () => {
    expect(await firstContent('a.txt', '情報シス\nテム')).toBe(
      '情報シス\nテム',
    );
  });

  it("DOCX keeps the author's break between Japanese characters", async () => {
    const content = await firstContent('a.docx', buildDocx(['情報シス\nテム']));

    expect(content).not.toContain('情報システム');
    expect(content).toContain('情報シス');
    expect(content).toContain('テム');
  });

  it('turns CRLF and CR in text into LF', async () => {
    expect(await firstContent('a.txt', 'one\r\ntwo\rthree')).toBe(
      'one\ntwo\nthree',
    );
  });
});
