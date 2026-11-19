import { isPlainCharacter } from '../plain-character';

// Mojibake counts for metric (c); research.md 12 defines what is counted.

const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);
const SAMPLE_LIMIT = 20;

export interface CharacterProblems {
  readonly replacementCharacters: number;
  /**
   * Characters that are not whitespace, printable ASCII or U+FFFD and that
   * the document's source does not hold; null when the source is unknown.
   */
  readonly unexpectedCharacters: number | null;
  /** The distinct unexpected characters, first seen first (at most 20). */
  readonly unexpectedSample: readonly string[];
}

export const findCharacterProblems = (
  text: string,
  sourceCharacters: string | undefined,
): CharacterProblems => {
  const chars = [...text];
  const replacementCharacters = chars.filter(
    (char) => char === REPLACEMENT_CHARACTER,
  ).length;
  if (sourceCharacters == null) {
    return {
      replacementCharacters,
      unexpectedCharacters: null,
      unexpectedSample: [],
    };
  }
  const declared = new Set(sourceCharacters);
  const unexpected = chars.filter(
    (char) =>
      char !== REPLACEMENT_CHARACTER &&
      !isPlainCharacter(char) &&
      !declared.has(char),
  );
  return {
    replacementCharacters,
    unexpectedCharacters: unexpected.length,
    unexpectedSample: [...new Set(unexpected)].slice(0, SAMPLE_LIMIT),
  };
};
