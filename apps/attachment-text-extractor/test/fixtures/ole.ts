import CFB from 'cfb';

export interface OleStream {
  /** Stream name at the root storage, e.g. `Workbook`. */
  readonly name: string;
  readonly content: Uint8Array;
}

const FREESECT = 0xffffffff;
// The header itself lists the first 109 FAT sectors (the DIFAT array).
const HEADER_DIFAT_SLOTS = 109;

/**
 * cfb pads unused FAT entries with ENDOFCHAIN (0xFFFFFFFE) where the spec and
 * xlwt / olefile write FREESECT; anydoc rejects such a file as malformed
 * (research.md 9.7). Returns a fixed copy.
 */
export const fixCfbFreeSectors = (ole: Uint8Array): Buffer => {
  const fixed = Buffer.from(ole);
  const sectorSize = 1 << fixed.readUInt16LE(0x1e);
  const sectorCount = (fixed.length - sectorSize) / sectorSize;
  const fatSectorCount = Math.min(fixed.readUInt32LE(0x2c), HEADER_DIFAT_SLOTS);
  const entriesPerSector = sectorSize / 4;
  for (let k = 0; k < fatSectorCount; k++) {
    const fatAt = sectorSize + fixed.readUInt32LE(0x4c + 4 * k) * sectorSize;
    const firstPastEnd = Math.max(0, sectorCount - k * entriesPerSector);
    for (let i = firstPastEnd; i < entriesPerSector; i++) {
      fixed.writeUInt32LE(FREESECT, fatAt + 4 * i);
    }
  }
  return fixed;
};

/** Writes an OLE compound file (the legacy Office container) with root streams. */
export const writeOle = (streams: readonly OleStream[]): Buffer => {
  const container = CFB.utils.cfb_new();
  for (const { name, content } of streams) {
    CFB.utils.cfb_add(container, `/${name}`, Buffer.from(content));
  }
  const written: unknown = CFB.write(container, { type: 'buffer' });
  if (!Buffer.isBuffer(written)) {
    throw new Error('cfb did not write a Buffer');
  }
  return fixCfbFreeSectors(written);
};
