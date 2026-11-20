import { deflateRawSync, inflateRawSync, inflateSync } from 'node:zlib';

import {
  buildLargeImagesDocx,
  buildLargeImagesPptx,
  buildTwelveImagesDocx,
  randomGrayPngs,
} from './large-images';
import {
  type RawZipEntry,
  readLocalBody,
  readZipDirectory,
} from './spec-support';

const MIB = 1024 * 1024;
// The Python service's MAX_FILE_SIZE_MB default, counted in MiB as it does.
const UPLOAD_LIMIT = 50 * MIB;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const LARGE_BUILD_TIMEOUT_MS = 60_000;

const pngChunk = (png: Buffer, kind: string): Buffer => {
  const at = png.indexOf(kind) - 4;
  return png.subarray(at + 8, at + 8 + png.readUInt32BE(at));
};

const directoryOf = (zip: Buffer): RawZipEntry[] => {
  const entries = readZipDirectory(zip);
  if (entries == null) {
    throw new Error('no central directory');
  }
  return entries;
};

const entryText = (zip: Buffer, name: string): string => {
  const entry = directoryOf(zip).find((candidate) => candidate.name === name);
  if (entry == null) {
    throw new Error(`no ZIP entry named ${name}`);
  }
  return inflateRawSync(readLocalBody(zip, entry)).toString('utf8');
};

const media = (zip: Buffer): RawZipEntry[] =>
  directoryOf(zip).filter((entry) => entry.name.includes('/media/'));

const compressedSum = (entries: readonly RawZipEntry[]): number =>
  entries.reduce((sum, entry) => sum + entry.compressedSize, 0);

describe('randomGrayPngs', () => {
  it('writes valid grayscale PNGs of the given side', () => {
    const [png] = randomGrayPngs(1, 64, 1);

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    const header = pngChunk(png, 'IHDR');
    expect(header.readUInt32BE(0)).toBe(64);
    expect(header.readUInt32BE(4)).toBe(64);
    // bit depth 8, colour type 0 (grayscale)
    expect([header[8], header[9]]).toEqual([8, 0]);
    // one filter byte per row, then the row
    expect(inflateSync(pngChunk(png, 'IDAT')).length).toBe(65 * 64);
  });

  it('fills the pixels with bytes that deflate cannot shrink', () => {
    const [png] = randomGrayPngs(1, 256, 7);

    const pixels = inflateSync(pngChunk(png, 'IDAT'));

    expect(deflateRawSync(pixels).length).toBeGreaterThan(pixels.length * 0.99);
  });

  it('repeats the same images for the same seed and differs for another', () => {
    const first = randomGrayPngs(2, 32, 40);

    expect(randomGrayPngs(2, 32, 40)).toEqual(first);
    expect(randomGrayPngs(2, 32, 41)).not.toEqual(first);
    expect(first[0]).not.toEqual(first[1]);
  });
});

describe('large image documents', () => {
  it(
    'builds a DOCX of 11 incompressible images between 40 MiB and the upload limit',
    () => {
      const docx = buildLargeImagesDocx();

      expect(docx.length).toBeGreaterThanOrEqual(40 * MIB);
      expect(docx.length).toBeLessThan(UPLOAD_LIMIT);
      expect(media(docx)).toHaveLength(11);
      expect(compressedSum(media(docx))).toBeGreaterThanOrEqual(40 * MIB);
      expect(entryText(docx, 'word/document.xml')).toContain(
        '<w:t>large docx with images</w:t>',
      );
    },
    LARGE_BUILD_TIMEOUT_MS,
  );

  it(
    'builds a PPTX of 11 incompressible images between 40 MiB and the upload limit',
    () => {
      const pptx = buildLargeImagesPptx();

      expect(pptx.length).toBeGreaterThanOrEqual(40 * MIB);
      expect(pptx.length).toBeLessThan(UPLOAD_LIMIT);
      expect(media(pptx)).toHaveLength(11);
      expect(compressedSum(media(pptx))).toBeGreaterThanOrEqual(40 * MIB);
      expect(entryText(pptx, 'ppt/slides/slide1.xml')).toContain(
        '<a:t>large pptx with images</a:t>',
      );
    },
    LARGE_BUILD_TIMEOUT_MS,
  );

  it(
    'builds the twelve-image DOCX of about 48 MiB that the RSS check uses',
    () => {
      const docx = buildTwelveImagesDocx();

      expect(media(docx)).toHaveLength(12);
      expect(docx.length).toBeGreaterThanOrEqual(47 * MIB);
      expect(docx.length).toBeLessThan(49 * MIB);
      expect(entryText(docx, 'word/document.xml')).toContain(
        '<w:t>docx with twelve images</w:t>',
      );
    },
    LARGE_BUILD_TIMEOUT_MS,
  );
});
