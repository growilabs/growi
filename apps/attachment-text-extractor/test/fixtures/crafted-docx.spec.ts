import {
  buildBrokenXmlDocx,
  buildDeeplyNestedDocx,
  buildDocxWithoutDocumentPart,
  buildTruncatedDocx,
  buildZipBombDocx,
  zipSignatureFollowedBy,
} from './crafted-docx';
import { buildDocx } from './docx';
import {
  anydocErrorCode,
  readZipDirectory,
  readZipEntries,
  readZipText,
} from './spec-support';

const MIB = 1024 * 1024;
// The Python service's MAX_ARCHIVE_UNCOMPRESSED_MB default.
const ARCHIVE_LIMIT = 512 * MIB;

describe('buildZipBombDocx', () => {
  it('is a small DOCX whose document part declares more than the archive limit', async () => {
    const docx = buildZipBombDocx();

    const entries = readZipDirectory(docx) ?? [];
    const document = entries.find(
      (entry) => entry.name === 'word/document.xml',
    );

    expect(docx.length).toBeLessThan(5 * MIB);
    expect(entries.map((entry) => entry.name)).toContain('[Content_Types].xml');
    expect(document?.uncompressedSize).toBeGreaterThan(ARCHIVE_LIMIT);
    expect(await anydocErrorCode(docx, 'docx')).toBe('resourceLimit');
  }, 30_000);
});

describe('buildDeeplyNestedDocx', () => {
  it('nests the body 100,000 levels deep in a DOCX under 1 MiB, which anydoc refuses', async () => {
    const docx = buildDeeplyNestedDocx();

    const xml = readZipText(docx, 'word/document.xml');

    expect(xml.split('<w:sdtContent>').length - 1).toBe(100_000);
    expect(xml.split('</w:sdtContent>').length - 1).toBe(100_000);
    expect(readZipEntries(docx).has('word/styles.xml')).toBe(true);
    expect(docx.length).toBeLessThan(MIB);
    expect(await anydocErrorCode(docx, 'docx')).toBe('resourceLimit');
  });
});

describe('broken DOCX packages', () => {
  it('cuts a real DOCX in half', async () => {
    const whole = buildDocx(['truncated']);

    const docx = buildTruncatedDocx();

    expect(docx).toEqual(whole.subarray(0, Math.floor(whole.length / 2)));
    expect(await anydocErrorCode(docx, 'docx')).toBe('malformed');
  });

  it('replaces the document part with markup that is not XML', async () => {
    const docx = buildBrokenXmlDocx();

    expect(readZipText(docx, 'word/document.xml')).toBe('<w:document <<<');
    expect(await anydocErrorCode(docx, 'docx')).toBe('malformed');
  });

  it('leaves the document part out', async () => {
    const docx = buildDocxWithoutDocumentPart();

    const names = [...readZipEntries(docx).keys()];

    expect(names).toContain('word/styles.xml');
    expect(names).not.toContain('word/document.xml');
    expect(await anydocErrorCode(docx, 'docx')).toBe('missingPart');
  });

  it('puts text right after a ZIP local header signature', async () => {
    const bytes = zipSignatureFollowedBy('CONTENT_MARKER');

    expect(bytes).toEqual(
      Buffer.from('PK\u0003\u0004CONTENT_MARKER', 'latin1'),
    );
    expect(await anydocErrorCode(bytes, 'docx')).toBe('malformed');
  });
});
