import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// BIZ UDGothic Regular 1.05 (SIL Open Font License 1.1), pinned to a
// google/fonts commit. A static TrueType font, so Chromium embeds it as a
// CIDFontType2 subset; the Noto Sans JP files tried wrote as Type3 glyphs in
// Chromium (research.md 11.3).
// Downloaded once into node_modules/.cache and never committed.

const GOOGLE_FONTS_COMMIT = '01ac47e0b1cddbc298334c69a5dfafb0205ffa28';
const BASE_URL = `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/ofl/bizudgothic`;

export const BENCHMARK_FONT = {
  url: `${BASE_URL}/BIZUDGothic-Regular.ttf`,
  sha256: '709fcd41e3209fb765da750472f55ccdf925653e9fa7e1eb007cb65c8f749c75',
  licenseUrl: `${BASE_URL}/OFL.txt`,
  /** The PostScript name a PDF's subset font carries after its tag. */
  postScriptName: 'BIZUDGothic-Regular',
} as const;

/** A PDF subset of the font is named `ABCDEF+BIZUDGothic-Regular`. */
export const isBenchmarkFontSubset = (fontName: string): boolean =>
  /^[A-Z]{6}\+/.test(fontName) &&
  fontName.slice(7) === BENCHMARK_FONT.postScriptName;

const CACHE_PATH = fileURLToPath(
  new URL(
    '../node_modules/.cache/attachment-text-extractor-benchmark/BIZUDGothic-Regular.ttf',
    import.meta.url,
  ),
);

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

const readCached = async (): Promise<Buffer | undefined> => {
  try {
    const cached = await readFile(CACHE_PATH);
    return sha256(cached) === BENCHMARK_FONT.sha256 ? cached : undefined;
  } catch {
    return undefined;
  }
};

const download = async (): Promise<Buffer> => {
  const response = await fetch(BENCHMARK_FONT.url);
  if (!response.ok) {
    throw new Error(`font download failed: HTTP ${response.status}`);
  }
  const font = Buffer.from(await response.arrayBuffer());
  if (sha256(font) !== BENCHMARK_FONT.sha256) {
    throw new Error(`font SHA-256 mismatch for ${BENCHMARK_FONT.url}`);
  }
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  const partial = join(dirname(CACHE_PATH), `.${process.pid}.partial`);
  await writeFile(partial, font);
  await rename(partial, CACHE_PATH);
  return font;
};

/** The pinned font file, verified by SHA-256. */
export const loadBenchmarkFont = async (): Promise<Buffer> =>
  (await readCached()) ?? (await download());
