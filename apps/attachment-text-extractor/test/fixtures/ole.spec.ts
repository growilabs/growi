import CFB from 'cfb';

import { fixCfbFreeSectors, writeOle } from './ole';

const OLE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const FREESECT = 0xffffffff;
const HEADER_DIFAT_SLOTS = 109;

// FAT entries that describe sectors beyond the end of the file.
const fatEntriesPastEnd = (ole: Buffer): number[] => {
  const sectorSize = 1 << ole.readUInt16LE(0x1e);
  const sectorCount = (ole.length - sectorSize) / sectorSize;
  const fatSectorCount = Math.min(ole.readUInt32LE(0x2c), HEADER_DIFAT_SLOTS);
  const entriesPerSector = sectorSize / 4;
  return Array.from({ length: fatSectorCount }).flatMap((_, k) => {
    const fatAt = sectorSize + ole.readUInt32LE(0x4c + 4 * k) * sectorSize;
    return Array.from({ length: entriesPerSector }, (_, i) => ({
      sector: k * entriesPerSector + i,
      value: ole.readUInt32LE(fatAt + 4 * i),
    }))
      .filter(({ sector }) => sector >= sectorCount)
      .map(({ value }) => value);
  });
};

describe('writeOle', () => {
  it('writes an OLE compound file whose streams read back unchanged', () => {
    const content = Buffer.from('stream content '.repeat(400));

    const ole = writeOle([{ name: 'Workbook', content }]);

    expect(ole.subarray(0, 8)).toEqual(OLE_MAGIC);
    const stream = CFB.find(CFB.read(ole, { type: 'buffer' }), 'Workbook');
    expect(Buffer.from(stream?.content ?? [])).toEqual(content);
  });

  it('marks every FAT entry past the last sector as free, as strict readers require', () => {
    const ole = writeOle([
      { name: 'Workbook', content: Buffer.alloc(5000, 1) },
    ]);

    const pastEnd = fatEntriesPastEnd(ole);

    expect(pastEnd.length).toBeGreaterThan(0);
    expect(pastEnd.every((value) => value === FREESECT)).toBe(true);
  });
});

describe('fixCfbFreeSectors', () => {
  it('returns a fixed copy and leaves the input as it was', () => {
    const container = CFB.utils.cfb_new();
    CFB.utils.cfb_add(container, '/Data', Buffer.alloc(5000, 2));
    const written: unknown = CFB.write(container, { type: 'buffer' });
    if (!Buffer.isBuffer(written)) {
      throw new Error('cfb did not return a Buffer');
    }
    const original = Buffer.from(written);
    // cfb's own output is what needs fixing.
    expect(fatEntriesPastEnd(written).some((value) => value !== FREESECT)).toBe(
      true,
    );

    const fixed = fixCfbFreeSectors(written);

    // Byte comparison: cfb attaches bookkeeping properties to its Buffers.
    expect(written.equals(original)).toBe(true);
    expect(fatEntriesPastEnd(fixed).every((value) => value === FREESECT)).toBe(
      true,
    );
  });
});
