import { replaceBatched } from './text/replace-batched';

// Hiragana, katakana (with the prolonged sound mark), CJK ideographs (unified
// and extension A) and the iteration mark. Other CJK punctuation and
// full-width forms are left out: they carry authored spacing.
const JAPANESE = 'ぁ-ゖゝ-ゟァ-ヺー-ヿ㐀-䶿一-鿿々';

// Lookarounds keep the neighbours unconsumed so chained gaps ("あ い う") all
// close, and the single-character match leaves blank lines and double spaces.
const JAPANESE_GAP = new RegExp(
  `(?<=[${JAPANESE}])[ \\n](?=[${JAPANESE}])`,
  'gu',
);
const CARRIAGE_RETURN = /\r\n?/g;

export const normalizeNewlines = (text: string): string =>
  replaceBatched(text, CARRIAGE_RETURN, () => '\n');

export const joinBrokenJapanese = (text: string): string =>
  replaceBatched(text, JAPANESE_GAP, () => '');
