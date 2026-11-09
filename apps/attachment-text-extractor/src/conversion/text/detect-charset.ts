import { decodeCp932 } from './cp932';

/** What detection may pick; ISO-2022-JP is found by its escapes before detection runs. */
export type DetectedCharset = 'shift_jis' | 'euc-jp' | 'windows-1252';

const CANDIDATES: readonly DetectedCharset[] = [
  'shift_jis',
  'euc-jp',
  'windows-1252',
];
const SAMPLE_BYTES = 64 * 1024;

// cp1252 punctuation that ordinary Western text uses.
const CP1252_TEXT_SYMBOLS: ReadonlySet<number> = new Set(
  [...'€‚„…†‡‰‹›‘’“”•–—™'].map((char) => char.codePointAt(0) ?? 0),
);

const isLowerAscii = (cp: number): boolean => cp >= 0x61 && cp <= 0x7a;

const asciiScore = (cp: number): number =>
  cp < 0x20 && cp !== 0x0a && cp !== 0x0d && cp !== 0x09 ? -5 : 0;

const isHalfwidthKana = (cp: number): boolean => cp >= 0xff61 && cp <= 0xff9f;

// EUC-JP reaches half-width katakana only through its SS2 byte, so reading one
// there is good evidence. Read as Shift_JIS, a lone one is typical of EUC-JP
// kanji bytes misread, while a run of them is real text (legacy names,
// addresses, bank records).
const halfwidthKanaScore = (
  previous: number,
  label: DetectedCharset,
): number => {
  if (label === 'euc-jp') return 3;
  return isHalfwidthKana(previous) ? 0.5 : -2;
};

const cjkScore = (
  cp: number,
  previous: number,
  label: DetectedCharset,
): number | null => {
  if (cp >= 0x3041 && cp <= 0x30ff) return 3; // hiragana / katakana
  if (cp >= 0x4e00 && cp <= 0x9fff) return 2; // CJK ideographs
  if ((cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff01 && cp <= 0xff5e)) {
    return 1; // CJK punctuation / full-width forms
  }
  if (isHalfwidthKana(cp)) return halfwidthKanaScore(previous, label);
  // Private use: the user-defined rows of Shift_JIS.
  if (cp >= 0xe000 && cp <= 0xf8ff) return -3;
  return null;
};

const charScore = (
  cp: number,
  previous: number,
  label: DetectedCharset,
): number => {
  if (cp < 0x80) return asciiScore(cp);
  const cjk = cjkScore(cp, previous, label);
  if (cjk !== null) return cjk;
  if (cp <= 0x9f) return -5; // C1 controls
  // Latin-1 / cp1252 symbols are suspicious in runs (mojibake).
  const runPenalty = previous >= 0x80 ? -1.5 : 0;
  if ((cp >= 0xc0 && cp <= 0xff) || CP1252_TEXT_SYMBOLS.has(cp)) {
    return 0.5 + runPenalty;
  }
  return -1 + runPenalty;
};

// A kana or kanji glued to a lowercase ASCII letter is a Latin word read as a
// double-byte code.
const gluedToLatin = (cp: number, previous: number, beforePrevious: number) =>
  (previous >= 0x3041 && (isLowerAscii(cp) || isLowerAscii(beforePrevious))) ||
  (cp >= 0x3041 && isLowerAscii(previous));

const textLikeness = (text: string, label: DetectedCharset): number => {
  const latin = label === 'windows-1252';
  let total = 0;
  let previous = 0;
  let beforePrevious = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    total += charScore(cp, previous, label);
    if (!latin && gluedToLatin(cp, previous, beforePrevious)) {
      total -= 4;
    }
    beforePrevious = previous;
    previous = cp;
  }
  return total;
};

// stream: a character cut at the sample edge is not an error; the caller
// decodes all bytes strictly afterwards.
const decodeSample = (
  label: DetectedCharset,
  sample: Uint8Array,
  stream: boolean,
): string | null => {
  // Shift_JIS is read as Python's cp932 reads it, so a few stray bytes do not
  // hand the text to windows-1252.
  if (label === 'shift_jis') {
    return decodeCp932(sample, stream);
  }
  try {
    return new TextDecoder(label, { fatal: true }).decode(sample, { stream });
  } catch {
    return null;
  }
};

/** The candidate whose strict decoding of the first 64 KiB looks most like text, or null when none decodes. */
export const detectCharset = (bytes: Uint8Array): DetectedCharset | null => {
  const sample = bytes.subarray(0, SAMPLE_BYTES);
  const stream = sample.length < bytes.length;
  let best: DetectedCharset | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const label of CANDIDATES) {
    const text = decodeSample(label, sample, stream);
    if (text === null) {
      continue;
    }
    const score = textLikeness(text, label);
    if (score > bestScore) {
      bestScore = score;
      best = label;
    }
  }
  return best;
};
