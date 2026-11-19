import type { ExpectedPhrase } from '../answers';

// How a phrase appears in extracted text, best first. The matching rules are
// defined in research.md 12.
export const PHRASE_MATCHES = [
  /** The phrase as written. */
  'exact',
  /** Only the whitespace the phrase itself holds differs (or is gone). */
  'whitespace-differs',
  /** Whitespace cuts the phrase only where the document printed a line break. */
  'split-at-line-break',
  /** Whitespace cuts the phrase somewhere else. */
  'split-elsewhere',
  'missing',
] as const;
export type PhraseMatch = (typeof PHRASE_MATCHES)[number];

export type PhraseToMatch = Pick<ExpectedPhrase, 'text' | 'lineBreakAfter'>;

const WHITESPACE = /\s/u;
const SYNTAX = /[\\^$.*+?()[\]{}|/]/gu;

interface PhrasePattern {
  readonly regex: RegExp;
  /** For each capture group, the code point offset in the phrase it sits at. */
  readonly gaps: readonly number[];
}

// Whitespace in the phrase may be any run of whitespace, or none; between
// two other characters, a captured run of whitespace marks a split.
const phrasePattern = (text: string): PhrasePattern => {
  const chars = [...text];
  const parts = chars.map((char, i) => {
    if (WHITESPACE.test(char)) {
      return i > 0 && WHITESPACE.test(chars[i - 1]) ? '' : '\\s*';
    }
    const escaped = char.replace(SYNTAX, '\\$&');
    return i > 0 && !WHITESPACE.test(chars[i - 1])
      ? `(\\s*)${escaped}`
      : escaped;
  });
  const gaps = chars.flatMap((char, i) =>
    i > 0 && !WHITESPACE.test(char) && !WHITESPACE.test(chars[i - 1])
      ? [i]
      : [],
  );
  return { regex: new RegExp(parts.join(''), 'gu'), gaps };
};

const classify = (
  phrase: PhraseToMatch,
  gaps: readonly number[],
  captures: readonly (string | undefined)[],
): PhraseMatch => {
  const cut = gaps.filter((_, g) => (captures[g] ?? '').length > 0);
  if (cut.length === 0) {
    return 'whitespace-differs';
  }
  return cut.every((offset) => offset === phrase.lineBreakAfter)
    ? 'split-at-line-break'
    : 'split-elsewhere';
};

export const betterMatch = (a: PhraseMatch, b: PhraseMatch): PhraseMatch =>
  PHRASE_MATCHES.indexOf(a) <= PHRASE_MATCHES.indexOf(b) ? a : b;

/** The best way the phrase appears in the text. */
export const matchPhrase = (
  content: string,
  phrase: PhraseToMatch,
): PhraseMatch => {
  if (content.includes(phrase.text)) {
    return 'exact';
  }
  const { regex, gaps } = phrasePattern(phrase.text);
  return [...content.matchAll(regex)]
    .map((match) => classify(phrase, gaps, match.slice(1)))
    .reduce<PhraseMatch>(betterMatch, 'missing');
};

export const isFound = (match: PhraseMatch): boolean => match !== 'missing';
