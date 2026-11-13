import {
  buildZip,
  pptxParts,
  xlsxParts,
  type ZipEntry,
} from '../../../test/fixtures';
import { readZipDirectory } from '../../../test/fixtures/spec-support';
import { convertOffice } from '../office';
import { conversionErrorOf, conversionLimits } from '../spec-support';
import { inspectArchive, type OoxmlArchive } from './archive-guard';
import { convertPptx } from './pptx-split';
import { enforceCellLimit } from './xlsx-cell-count';
import { convertXlsx } from './xlsx-split';

// anydoc is not under test here; each slide package converts to one line.
vi.mock('../office', () => ({ convertOffice: vi.fn() }));

// Verdicts taken from the Python service on the same shapes: CPython refuses
// a part flagged "compressed patched data" (bit 5) or "strong encryption"
// (bit 6) only when it is read, and the service calls that refusal
// `encrypted` when the part also carries the encryption flag (bit 0).
const PATCHED = 0x20;
const STRONG = 0x40;
const ENCRYPTED = 0x01;
const MIB = 1024 * 1024;
const PRESENTATION = 'ppt/presentation.xml';
const WORKBOOK = 'xl/workbook.xml';
const CENTRAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const LOCAL_FLAGS_FIELD = 6;
const CENTRAL_FLAGS_FIELD = 8;

/** The ZIP of `entries` with `flags` set on its last entry, in both of its headers. */
const zipFlaggingLast = (
  entries: readonly ZipEntry[],
  flags: number,
): Buffer => {
  const zip = buildZip(entries);
  const local = (readZipDirectory(zip) ?? []).at(-1)?.localHeaderOffset ?? -1;
  zip.writeUInt16LE(flags, local + LOCAL_FLAGS_FIELD);
  zip.writeUInt16LE(
    flags,
    zip.lastIndexOf(CENTRAL_SIGNATURE) + CENTRAL_FLAGS_FIELD,
  );
  return zip;
};

const flaggingLast = (
  members: readonly (readonly [string, string])[],
  flags: number,
): Buffer =>
  zipFlaggingLast(
    members.map(([name, data]) => ({ name, data })),
    flags,
  );

const opened = async (
  zip: Buffer,
  requiredPart: string,
  cells = 70_000,
): Promise<OoxmlArchive> => {
  const archive = await inspectArchive(
    zip,
    requiredPart,
    conversionLimits({ maxXlsxCells: cells }),
  );
  if (archive == null) {
    throw new Error('expected the archive to be returned, got pass-through');
  }
  return archive;
};

const readKind = async (zip: Buffer, part: string): Promise<string> => {
  const archive = await opened(zip, PRESENTATION);
  try {
    return (await conversionErrorOf(() => archive.readPart(part, MIB))).kind;
  } finally {
    archive.close();
  }
};

const cellLimitKind = async (zip: Buffer, cells: number): Promise<string> => {
  const archive = await opened(zip, WORKBOOK, cells);
  try {
    return (
      await conversionErrorOf(() =>
        enforceCellLimit(archive, conversionLimits({ maxXlsxCells: cells })),
      )
    ).kind;
  } finally {
    archive.close();
  }
};

const FLAG_CASES = [
  ['patched data', PATCHED, 'malformed'],
  ['patched data with the encryption flag', PATCHED | ENCRYPTED, 'encrypted'],
  ['strong encryption', STRONG, 'malformed'],
  [
    'strong encryption with the encryption flag',
    STRONG | ENCRYPTED,
    'encrypted',
  ],
] as const;

describe('a part flagged patched or strongly encrypted', () => {
  it.each(
    FLAG_CASES,
  )('refuses reading a part flagged %s (flags %i) as %s', async (_, flags, kind) => {
    const zip = flaggingLast(
      [
        ['other.xml', '<o/>'],
        [PRESENTATION, '<x/>'],
      ],
      flags,
    );

    expect(await readKind(zip, PRESENTATION)).toBe(kind);
  });

  it.each(
    FLAG_CASES,
  )('still reads the other parts when one is flagged %s', async (_, flags) => {
    const zip = flaggingLast(
      [
        [PRESENTATION, '<x/>'],
        ['other.xml', '<o/>'],
      ],
      flags,
    );
    const archive = await opened(zip, PRESENTATION);

    try {
      expect((await archive.readPart(PRESENTATION, MIB)).toString()).toBe(
        '<x/>',
      );
    } finally {
      archive.close();
    }
  });
});

describe('the cell pre-check over a flagged part', () => {
  const workbookThenFlagged = (flags: number): Buffer =>
    flaggingLast(
      [
        [WORKBOOK, '<workbook/>'],
        [
          'xl/worksheets/sheet1.xml',
          `<worksheet><sheetData><row>${'<c/>'.repeat(5)}</row></sheetData></worksheet>`,
        ],
        ['xl/media/x.bin', 'x'],
      ],
      flags,
    );

  it.each(
    FLAG_CASES,
  )('stops at the cell limit before a part flagged %s', async (_, flags) => {
    expect(await cellLimitKind(workbookThenFlagged(flags), 4)).toBe(
      'limit_exceeded',
    );
  });

  it.each(
    FLAG_CASES,
  )('refuses scanning a part flagged %s (flags %i) as %s', async (_, flags, kind) => {
    expect(await cellLimitKind(workbookThenFlagged(flags), 10)).toBe(kind);
  });
});

// CPython finds an archive after prepended bytes; the strong-encryption flag is
// then cleared in a copy that starts where the archive does.
describe('a flagged part in an archive after prepended bytes', () => {
  const PREPENDED = Buffer.alloc(4096, 0x4d);

  beforeEach(() => {
    vi.mocked(convertOffice).mockReset();
    vi.mocked(convertOffice).mockResolvedValue('slide text\n');
  });

  it('splits a PPTX whose unread part is flagged strong encryption', async () => {
    const deck = Buffer.concat([
      PREPENDED,
      zipFlaggingLast(
        [
          ...pptxParts([{ title: 'First' }, { title: 'Second' }]),
          { name: 'customXml/item1.xml', data: '<x/>' },
        ],
        STRONG,
      ),
    ]);

    expect(await convertPptx(deck, conversionLimits())).toEqual([
      { pageNumber: 1, label: '1', content: 'slide text\n' },
      { pageNumber: 2, label: '2', content: 'slide text\n' },
    ]);
  });

  it('refuses an XLSX whose scanned part is flagged strong encryption as malformed', async () => {
    const workbook = Buffer.concat([
      PREPENDED,
      zipFlaggingLast(
        [
          ...xlsxParts([{ name: 'A', rows: [['a']] }]),
          { name: 'xl/media/x.bin', data: 'x' },
        ],
        STRONG,
      ),
    ]);

    const error = await conversionErrorOf(() =>
      convertXlsx(workbook, conversionLimits()),
    );

    expect(error.kind).toBe('malformed');
    expect(convertOffice).not.toHaveBeenCalled();
  });
});
