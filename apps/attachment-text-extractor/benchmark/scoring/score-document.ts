import type {
  BenchmarkEncoding,
  BenchmarkFeature,
  BenchmarkFormat,
  DocumentAnswer,
  ExpectedPage,
  ExpectedPhrase,
} from '../answers';
import type { ExtractedPage, ExtractOutcome } from '../extraction';
import {
  type CharacterProblems,
  findCharacterProblems,
} from './character-problems';
import {
  betterMatch,
  isFound,
  matchPhrase,
  type PhraseMatch,
} from './phrase-match';

export interface PhraseScore {
  readonly text: string;
  /** The expected position: a 1-based index into `pages[]`. */
  readonly page: number;
  /** The best match over all elements. */
  readonly match: PhraseMatch;
  /** The match in the element at the expected index alone. */
  readonly matchAtExpectedPosition: PhraseMatch;
  /** 1-based indexes of the elements the phrase was found in. */
  readonly foundOnPages: readonly number[];
  /** Found in the element at the expected index. */
  readonly atExpectedPosition: boolean;
  /** Found in some element other than the expected one. */
  readonly foundOnOtherElements: boolean;
}

export interface PageScore {
  readonly expected: number;
  /** null when the request failed. */
  readonly actual: number | null;
  /** Elements, compared in order, whose pageNumber and label both match. */
  readonly elementsCorrect: number;
  /** XLSX: elements that carry their sheet name in the label or the content. */
  readonly sheetNames: {
    readonly correct: number;
    readonly total: number;
  } | null;
}

export interface DocumentScore {
  readonly fileName: string;
  readonly format: BenchmarkFormat;
  readonly encoding?: BenchmarkEncoding;
  readonly features: readonly BenchmarkFeature[];
  /** Why the request failed; null when the service answered. */
  readonly failure: string | null;
  readonly phrases: readonly PhraseScore[];
  readonly pages: PageScore;
  readonly characters: CharacterProblems;
  readonly absentPhrases: {
    readonly total: number;
    /** Phrases that must stay out, found in the output (whitespace ignored). */
    readonly leaked: readonly string[];
  };
}

const scorePhrase = (
  phrase: ExpectedPhrase,
  pages: readonly ExtractedPage[],
): PhraseScore => {
  const matches = pages.map((page) => matchPhrase(page.content, phrase));
  const matchAtExpectedPosition = matches[phrase.page - 1] ?? 'missing';
  const foundOnPages = matches.flatMap((match, i) =>
    isFound(match) ? [i + 1] : [],
  );
  return {
    text: phrase.text,
    page: phrase.page,
    match: matches.reduce<PhraseMatch>(betterMatch, 'missing'),
    matchAtExpectedPosition,
    foundOnPages,
    atExpectedPosition: isFound(matchAtExpectedPosition),
    foundOnOtherElements: foundOnPages.some((page) => page !== phrase.page),
  };
};

const elementMatches = (expected: ExpectedPage, actual: ExtractedPage) =>
  expected.pageNumber === actual.pageNumber && expected.label === actual.label;

const carriesSheetName = (sheetName: string, actual: ExtractedPage) =>
  actual.label === sheetName || actual.content.includes(sheetName);

const scorePages = (
  expected: readonly ExpectedPage[],
  actual: readonly ExtractedPage[] | null,
): PageScore => {
  const pairs = expected.flatMap((page, i) => {
    const got = actual?.[i];
    return got == null ? [] : [[page, got] as const];
  });
  const sheets = expected.flatMap((page) =>
    page.sheetName == null ? [] : [page.sheetName],
  );
  return {
    expected: expected.length,
    actual: actual?.length ?? null,
    elementsCorrect: pairs.filter(([want, got]) => elementMatches(want, got))
      .length,
    sheetNames:
      sheets.length === 0
        ? null
        : {
            correct: pairs.filter(
              ([want, got]) =>
                want.sheetName != null && carriesSheetName(want.sheetName, got),
            ).length,
            total: sheets.length,
          },
  };
};

/** Scores one document's `POST /extract` outcome against its answer. */
export const scoreDocument = (
  answer: DocumentAnswer,
  outcome: ExtractOutcome,
): DocumentScore => {
  const pages = outcome.ok ? outcome.pages : [];
  const text = pages.map((page) => page.content).join('\n');
  const absent = answer.absentPhrases ?? [];
  return {
    fileName: answer.fileName,
    format: answer.format,
    ...(answer.encoding == null ? {} : { encoding: answer.encoding }),
    features: answer.features,
    failure: outcome.ok ? null : outcome.reason,
    phrases: answer.phrases.map((phrase) => scorePhrase(phrase, pages)),
    pages: scorePages(answer.expectedPages, outcome.ok ? outcome.pages : null),
    characters: findCharacterProblems(text, answer.sourceCharacters),
    absentPhrases: {
      total: absent.length,
      leaked: absent.filter((phrase) =>
        pages.some((page) =>
          isFound(matchPhrase(page.content, { text: phrase })),
        ),
      ),
    },
  };
};
