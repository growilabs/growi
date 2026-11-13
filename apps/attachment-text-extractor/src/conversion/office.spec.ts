import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc';

import {
  buildBrokenXmlDocx,
  buildDeeplyNestedDocx,
  buildDocx,
  buildDocxWithoutDocumentPart,
  buildEncryptedDocx,
  buildEncryptedPptx,
  buildEncryptedXlsx,
  buildTruncatedDocx,
  buildZipBombDocx,
  ENCRYPTED_MARKER,
  JAPANESE_SAMPLE,
  LEGACY_DOC_PATH,
  LEGACY_PPT_PATH,
  PLAIN_DOCUMENTS,
} from '../../test/fixtures';
import { convertOffice } from './office';
import { conversionErrorOf } from './spec-support';

// anydoc is the outbound boundary: the real converter still runs, but each
// call across it is recorded, and a test can make one call reject.
vi.mock('@firecrawl/anydoc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@firecrawl/anydoc')>();
  return { ...actual, toMarkdownBytes: vi.fn(actual.toMarkdownBytes) };
});

const SECRET = 'TOPSECRET-BODY';

/** What a logger printing the whole error (stack and cause included) would show. */
const logged = (error: Error): string => inspect(error, { depth: 10 });

const anydocError = (code: string, message: string): Error =>
  Object.assign(new Error(message), { code });

afterEach(() => {
  vi.mocked(toMarkdownBytes).mockReset();
});

describe('convertOffice', () => {
  describe('converts into one text', () => {
    it('converts a DOCX', async () => {
      const text = await convertOffice(buildDocx(['DOCX body marker']), 'docx');

      expect(text).toContain('DOCX body marker');
    });

    it('converts an RTF', async () => {
      const text = await convertOffice(PLAIN_DOCUMENTS.rtf.build(), 'rtf');

      expect(text).toContain('RTF body marker');
      expect(text).toContain('本番環境で発生した情報システムの障害');
    });

    it('converts an EPUB', async () => {
      const text = await convertOffice(PLAIN_DOCUMENTS.epub.build(), 'epub');

      expect(text).toContain('EPUB chapter marker');
      expect(text).toContain('第一章');
    });

    it('converts a CSV without a signature because the format is explicit', async () => {
      const text = await convertOffice(
        Buffer.from('名前,値\nりんご,1\n'),
        'csv',
      );

      expect(text).toContain('りんご');
      expect(text).toContain('名前');
    });

    it('converts a legacy DOC', async () => {
      const text = await convertOffice(readFileSync(LEGACY_DOC_PATH), 'doc');

      expect(text).toContain('Cell 1,1');
    });

    it('converts a legacy PPT', async () => {
      const text = await convertOffice(readFileSync(LEGACY_PPT_PATH), 'ppt');

      expect(text).toContain('Text in a TextBox');
    });

    it('converts a legacy XLS under the format name xlsx', async () => {
      const text = await convertOffice(PLAIN_DOCUMENTS.xls.build(), 'xlsx');

      expect(text).toContain('XLS cell marker');
      expect(text).toContain('second sheet');
    });

    it.each([
      ['odt', 'OpenDocument text marker'],
      ['ods', 'OpenDocument sheet marker'],
      ['odp', 'OpenDocument slide marker'],
    ] as const)('converts an OpenDocument %s', async (format, marker) => {
      const text = await convertOffice(PLAIN_DOCUMENTS[format].build(), format);

      expect(text).toContain(marker);
    });

    it('returns the text of a Japanese DOCX', async () => {
      const text = await convertOffice(
        buildDocx([JAPANESE_SAMPLE.replace('\n', ' ')]),
        'docx',
      );

      expect(text).toContain('障害対応メモ');
    });
  });

  describe('no external transmission (Req 4.5)', () => {
    it('calls anydoc once with the explicit format and no ocr option', async () => {
      vi.mocked(toMarkdownBytes).mockResolvedValueOnce('converted');
      const payload = Buffer.from('payload');

      const text = await convertOffice(payload, 'docx');

      expect(text).toBe('converted');
      expect(toMarkdownBytes).toHaveBeenCalledTimes(1);
      const [bytes, format, options] = vi.mocked(toMarkdownBytes).mock
        .calls[0] ?? [undefined, undefined, undefined];
      expect(bytes).toEqual(payload);
      expect(format).toBe(formatFromExtension('docx'));
      expect(options ?? {}).not.toHaveProperty('ocr');
    });
  });

  describe('classifies real failures', () => {
    it.each([
      ['DOCX', buildEncryptedDocx, 'docx'],
      ['XLSX', buildEncryptedXlsx, 'xlsx'],
      ['PPTX', buildEncryptedPptx, 'pptx'],
    ] as const)('classifies an encrypted %s as encrypted', async (_name, build, format) => {
      const failure = await conversionErrorOf(() =>
        convertOffice(build(), format),
      );

      expect(failure.kind).toBe('encrypted');
    });

    it('classifies a truncated DOCX as malformed', async () => {
      const failure = await conversionErrorOf(() =>
        convertOffice(buildTruncatedDocx(), 'docx'),
      );

      expect(failure.kind).toBe('malformed');
    });

    it('classifies a DOCX with broken XML as malformed', async () => {
      const failure = await conversionErrorOf(() =>
        convertOffice(buildBrokenXmlDocx(), 'docx'),
      );

      expect(failure.kind).toBe('malformed');
    });

    it('classifies a DOCX without its document part as malformed', async () => {
      const failure = await conversionErrorOf(() =>
        convertOffice(buildDocxWithoutDocumentPart(), 'docx'),
      );

      expect(failure.kind).toBe('malformed');
    });

    it('classifies a legacy binary given as DOCX as malformed', async () => {
      const failure = await conversionErrorOf(() =>
        convertOffice(readFileSync(LEGACY_PPT_PATH), 'docx'),
      );

      expect(failure.kind).toBe('malformed');
    });

    it('classifies a DOCX expanding past the entry limit as limit_exceeded naming the limit', async () => {
      const failure = await conversionErrorOf(() =>
        convertOffice(buildZipBombDocx(), 'docx'),
      );

      expect(failure.kind).toBe('limit_exceeded');
      expect(failure.detail).toContain('max_entry_bytes');
    }, 30_000);

    it('classifies a deeply nested DOCX as limit_exceeded naming the limit', async () => {
      const failure = await conversionErrorOf(() =>
        convertOffice(buildDeeplyNestedDocx(), 'docx'),
      );

      expect(failure.kind).toBe('limit_exceeded');
      expect(failure.detail).toContain('max_xml_depth');
    });
  });

  describe('keeps file content out of the failure', () => {
    it('does not echo the input bytes anydoc quotes in its message', async () => {
      // anydoc's CFB error quotes the first bytes of the input, i.e. file content.
      const bytes = Buffer.from(SECRET.repeat(50));
      const quoted = [...bytes.subarray(0, 8)]
        .map((byte) => byte.toString(16))
        .join(', ');
      const raw = await toMarkdownBytes(bytes, formatFromExtension('doc')).then(
        () => '',
        (error: unknown) => String(error),
      );
      expect(raw).toContain(quoted);

      const failure = await conversionErrorOf(() =>
        convertOffice(bytes, 'doc'),
      );

      expect(failure.kind).toBe('malformed');
      expect(failure.detail).not.toContain(quoted);
      expect(logged(failure)).not.toContain(quoted);
      expect(failure.detail).not.toContain(SECRET);
    });

    it('does not echo part names from the archive in a limit failure', async () => {
      const failure = await conversionErrorOf(() =>
        convertOffice(buildZipBombDocx(), 'docx'),
      );

      expect(failure.detail).not.toContain('word/document.xml');
      expect(logged(failure)).not.toContain('word/document.xml');
    }, 30_000);

    it('does not carry the document text into an encrypted failure', async () => {
      const failure = await conversionErrorOf(() =>
        convertOffice(buildEncryptedDocx(), 'docx'),
      );

      expect(failure.detail).not.toContain(ENCRYPTED_MARKER);
    });
  });

  describe('classifies every rejection by its ConvertErrorCode without leaking the message', () => {
    it.each<[string, unknown, string]>([
      [
        'unsupported',
        anydocError('unsupported', `unsupported: ${SECRET}`),
        'unsupported',
      ],
      [
        'missingPart',
        anydocError('missingPart', `missing required part: ${SECRET}`),
        'malformed',
      ],
      [
        'malformed',
        anydocError('malformed', `malformed document: ${SECRET}`),
        'malformed',
      ],
      [
        'encrypted',
        anydocError('encrypted', `encrypted: ${SECRET}`),
        'encrypted',
      ],
      // Any Error without a ConvertErrorCode. A Rust panic is not this case: it
      // aborts the child, which the parent classifies as crashed (design.md).
      [
        'an Error without a code',
        new Error(`index out of bounds: ${SECRET}`),
        'internal',
      ],
      ['needsOcr', anydocError('needsOcr', SECRET), 'internal'],
      ['hosted', anydocError('hosted', SECRET), 'internal'],
      ['io', anydocError('io', SECRET), 'internal'],
      ['a RangeError', new RangeError(SECRET), 'internal'],
      ['a TypeError', new TypeError(SECRET), 'internal'],
      ['a thrown string', SECRET, 'internal'],
      [
        'a thrown plain object',
        { code: 'encrypted', message: SECRET },
        'internal',
      ],
    ])('maps %s to its failure kind', async (_name, thrown, kind) => {
      vi.mocked(toMarkdownBytes).mockRejectedValueOnce(thrown);

      const failure = await conversionErrorOf(() =>
        convertOffice(Buffer.from('payload'), 'docx'),
      );

      expect(failure.kind).toBe(kind);
      expect(failure.detail).not.toContain(SECRET);
      expect(logged(failure)).not.toContain(SECRET);
    });

    it('keeps only the limit identifier from a resourceLimit message', async () => {
      vi.mocked(toMarkdownBytes).mockRejectedValueOnce(
        anydocError(
          'resourceLimit',
          `resource limit exceeded (max_entry_bytes): ${SECRET} declares 9 bytes`,
        ),
      );

      const failure = await conversionErrorOf(() =>
        convertOffice(Buffer.from('payload'), 'docx'),
      );

      expect(failure.kind).toBe('limit_exceeded');
      expect(failure.detail).toContain('max_entry_bytes');
      expect(logged(failure)).not.toContain(SECRET);
    });
  });
});
