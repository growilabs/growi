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

declare const lfOnly: unique symbol;
/** Text whose every newline is LF: what the result budget counts (research.md §9.7). */
export type LfText = string & { readonly [lfOnly]: true };

// The only places a string becomes LfText: CR and CRLF are all replaced here,
// and closing a gap removes characters without adding any.
export const normalizeNewlines = (text: string): LfText =>
  replaceBatched(text, CARRIAGE_RETURN, () => '\n') as LfText;

export function joinBrokenJapanese(text: LfText): LfText;
export function joinBrokenJapanese(text: string): string;
export function joinBrokenJapanese(text: string): string {
  return replaceBatched(text, JAPANESE_GAP, () => '');
}
