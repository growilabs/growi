import { BENCHMARK_FORMATS, type BenchmarkFormat } from '../answers';
import { isFound, type PhraseMatch } from './phrase-match';
import type { DocumentScore } from './score-document';

/** Counts for one format (or `all`); the report turns them into rates. */
export interface FormatSummary {
  readonly format: BenchmarkFormat | 'all';
  readonly documents: number;
  readonly failed: number;
  // (a) recall. A failed document's phrases count as not found.
  readonly phrases: number;
  readonly exact: number;
  /** Found as written or with whitespace ignored (any match but missing). */
  readonly found: number;
  // (b) positions
  readonly pageCountCorrect: number;
  readonly pageElements: number;
  readonly pageElementsCorrect: number;
  readonly sheetNames: {
    readonly correct: number;
    readonly total: number;
  } | null;
  readonly atExpectedPosition: number;
  readonly foundOnlyElsewhere: number;
  /** At the expected position and in another element as well. */
  readonly alsoFoundElsewhere: number;
  // (c) mojibake and splits
  /** Splits by the best match over all elements. */
  readonly splitAtLineBreak: number;
  readonly splitElsewhere: number;
  /** Splits in the element at the expected position alone. */
  readonly splitAtLineBreakAtPosition: number;
  readonly splitElsewhereAtPosition: number;
  readonly replacementCharacters: number;
  /** null when no document in the group declares its source characters. */
  readonly unexpectedCharacters: number | null;
  readonly absentPhrases: number;
  readonly absentPhrasesLeaked: number;
}

const sum = <T>(items: readonly T[], count: (item: T) => number): number =>
  items.reduce((total, item) => total + count(item), 0);

const sumSheetNames = (scores: readonly DocumentScore[]) => {
  const counted = scores.flatMap((score) =>
    score.pages.sheetNames == null ? [] : [score.pages.sheetNames],
  );
  return counted.length === 0
    ? null
    : {
        correct: sum(counted, (s) => s.correct),
        total: sum(counted, (s) => s.total),
      };
};

const sumUnexpected = (scores: readonly DocumentScore[]): number | null => {
  const counted = scores.flatMap((score) =>
    score.characters.unexpectedCharacters == null
      ? []
      : [score.characters.unexpectedCharacters],
  );
  return counted.length === 0 ? null : sum(counted, (n) => n);
};

const summarize = (
  format: BenchmarkFormat | 'all',
  scores: readonly DocumentScore[],
): FormatSummary => {
  const phrases = scores.flatMap((score) => score.phrases);
  const countMatch = (match: PhraseMatch) =>
    phrases.filter((phrase) => phrase.match === match).length;
  const countMatchAtPosition = (match: PhraseMatch) =>
    phrases.filter((phrase) => phrase.matchAtExpectedPosition === match).length;
  return {
    format,
    documents: scores.length,
    failed: scores.filter((score) => score.failure != null).length,
    phrases: phrases.length,
    exact: countMatch('exact'),
    found: phrases.filter((phrase) => isFound(phrase.match)).length,
    pageCountCorrect: scores.filter(
      (score) => score.pages.actual === score.pages.expected,
    ).length,
    pageElements: sum(scores, (score) => score.pages.expected),
    pageElementsCorrect: sum(scores, (score) => score.pages.elementsCorrect),
    sheetNames: sumSheetNames(scores),
    atExpectedPosition: phrases.filter((phrase) => phrase.atExpectedPosition)
      .length,
    foundOnlyElsewhere: phrases.filter(
      (phrase) => isFound(phrase.match) && !phrase.atExpectedPosition,
    ).length,
    alsoFoundElsewhere: phrases.filter(
      (phrase) => phrase.atExpectedPosition && phrase.foundOnOtherElements,
    ).length,
    splitAtLineBreak: countMatch('split-at-line-break'),
    splitElsewhere: countMatch('split-elsewhere'),
    splitAtLineBreakAtPosition: countMatchAtPosition('split-at-line-break'),
    splitElsewhereAtPosition: countMatchAtPosition('split-elsewhere'),
    replacementCharacters: sum(
      scores,
      (score) => score.characters.replacementCharacters,
    ),
    unexpectedCharacters: sumUnexpected(scores),
    absentPhrases: sum(scores, (score) => score.absentPhrases.total),
    absentPhrasesLeaked: sum(
      scores,
      (score) => score.absentPhrases.leaked.length,
    ),
  };
};

/** One summary per measured format, in BENCHMARK_FORMATS order. */
export const summarizeByFormat = (
  scores: readonly DocumentScore[],
): FormatSummary[] =>
  BENCHMARK_FORMATS.flatMap((format) => {
    const ofFormat = scores.filter((score) => score.format === format);
    return ofFormat.length === 0 ? [] : [summarize(format, ofFormat)];
  });

export const summarizeAll = (scores: readonly DocumentScore[]): FormatSummary =>
  summarize('all', scores);
