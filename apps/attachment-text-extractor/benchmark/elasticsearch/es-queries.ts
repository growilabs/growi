import { BENCHMARK_FORMATS, type BenchmarkFormat } from '../answers';
import type { ExtractedPage } from '../extraction';

// Request bodies for the Elasticsearch stage (Req 2.10) and the recall it
// yields. Why these analyzers and queries: research.md 12.

/**
 * - `kuromoji-phrase`: match_phrase on content.ja (GROWI's kuromoji analyzer),
 *   i.e. the phrase's kuromoji tokens appear in order.
 * - `growi-quoted-phrase`: match_phrase on content (standard analyzer), the
 *   query GROWI runs for a "quoted" search term.
 */
export const ES_QUERY_VARIANTS = [
  'kuromoji-phrase',
  'growi-quoted-phrase',
] as const;
export type EsQueryVariant = (typeof ES_QUERY_VARIANTS)[number];

const VARIANT_FIELDS: Record<EsQueryVariant, string> = {
  'kuromoji-phrase': 'content.ja',
  'growi-quoted-phrase': 'content',
};

export interface EsPlugins {
  readonly kuromoji: boolean;
  readonly icu: boolean;
}

type Fields = Readonly<Record<string, unknown>>;

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the body of `GET /_cat/plugins?format=json`. */
export const parsePlugins = (body: unknown): EsPlugins => {
  if (!Array.isArray(body)) {
    throw new Error('_cat/plugins: expected a JSON array');
  }
  const components = new Set(
    body.flatMap((row) =>
      isFields(row) && typeof row.component === 'string' ? [row.component] : [],
    ),
  );
  return {
    kuromoji: components.has('analysis-kuromoji'),
    icu: components.has('analysis-icu'),
  };
};

/** GROWI's `japanese` analyzer; without ICU when the plugin is missing. */
export const japaneseAnalyzer = (plugins: EsPlugins) => ({
  tokenizer: 'kuromoji_tokenizer',
  ...(plugins.icu ? { char_filter: ['icu_normalizer'] } : {}),
});

/**
 * The `content` field and its `japanese` analyzer as GROWI's attachment index
 * defines them (apps/app/src/features/search-attachments/server/mappings/
 * attachments-mappings-es9.ts), plus the fields the benchmark filters on.
 */
export const indexBody = (plugins: EsPlugins) => ({
  settings: {
    analysis: {
      analyzer: {
        japanese: { type: 'custom', ...japaneseAnalyzer(plugins) },
      },
    },
  },
  mappings: {
    properties: {
      fileName: { type: 'keyword' },
      elementIndex: { type: 'integer' },
      content: {
        type: 'text',
        fields: { ja: { type: 'text', analyzer: 'japanese' } },
      },
    },
  },
});

export interface IndexedDocument {
  readonly fileName: string;
  readonly pages: readonly ExtractedPage[];
}

/** An NDJSON `_bulk` body: one ES document per `pages[]` element. */
export const bulkBody = (documents: readonly IndexedDocument[]): string =>
  documents
    .flatMap(({ fileName, pages }) =>
      pages.flatMap((page, i) => [
        { index: {} },
        { fileName, elementIndex: i + 1, content: page.content },
      ]),
    )
    .map((line) => `${JSON.stringify(line)}\n`)
    .join('');

const SEARCH_SIZE = 100;

export const phraseQuery = (
  variant: EsQueryVariant,
  fileName: string,
  text: string,
) => ({
  size: SEARCH_SIZE,
  _source: ['elementIndex'],
  query: {
    bool: {
      must: [{ match_phrase: { [VARIANT_FIELDS[variant]]: text } }],
      filter: [{ term: { fileName } }],
    },
  },
});

/** The `elementIndex` of each hit in a `_search` response body. */
export const hitElementIndexes = (body: unknown): number[] => {
  const hits =
    isFields(body) && isFields(body.hits) && Array.isArray(body.hits.hits)
      ? body.hits.hits
      : null;
  if (hits == null) {
    throw new Error('_search: expected hits.hits in the response');
  }
  return hits.flatMap((hit) =>
    isFields(hit) &&
    isFields(hit._source) &&
    typeof hit._source.elementIndex === 'number'
      ? [hit._source.elementIndex]
      : [],
  );
};

export interface EsPhraseResult {
  readonly fileName: string;
  readonly text: string;
  readonly format: BenchmarkFormat;
  readonly variant: EsQueryVariant;
  /** The expected element (1-based). */
  readonly page: number;
  /** The elements the query found in the phrase's document. */
  readonly elementIndexes: readonly number[];
}

export interface EsFormatRecall {
  readonly format: BenchmarkFormat | 'all';
  readonly variant: EsQueryVariant;
  readonly phrases: number;
  /** Phrases whose document the query found. */
  readonly documentFound: number;
  /** Phrases the query found in their expected element. */
  readonly positionFound: number;
  /** Phrases the query found in some element other than the expected one. */
  readonly extraElementHits: number;
}

const hitsOtherElement = (r: EsPhraseResult): boolean =>
  r.elementIndexes.some((index) => index !== r.page);

const isOnTarget = (r: EsPhraseResult): boolean =>
  r.elementIndexes.includes(r.page) && !hitsOtherElement(r);

const recallOf = (
  format: BenchmarkFormat | 'all',
  variant: EsQueryVariant,
  results: readonly EsPhraseResult[],
): EsFormatRecall => ({
  format,
  variant,
  phrases: results.length,
  documentFound: results.filter((r) => r.elementIndexes.length > 0).length,
  positionFound: results.filter((r) => r.elementIndexes.includes(r.page))
    .length,
  extraElementHits: results.filter(hitsOtherElement).length,
});

/** Per query variant, then per format in BENCHMARK_FORMATS order. */
export const esRecallByFormat = (
  results: readonly EsPhraseResult[],
): EsFormatRecall[] =>
  ES_QUERY_VARIANTS.flatMap((variant) =>
    BENCHMARK_FORMATS.flatMap((format) => {
      const matching = results.filter(
        (r) => r.variant === variant && r.format === format,
      );
      return matching.length === 0 ? [] : [recallOf(format, variant, matching)];
    }),
  );

export const esRecallAll = (
  results: readonly EsPhraseResult[],
): EsFormatRecall[] =>
  ES_QUERY_VARIANTS.flatMap((variant) => {
    const matching = results.filter((r) => r.variant === variant);
    return matching.length === 0 ? [] : [recallOf('all', variant, matching)];
  });

export type EsPositionProblem = Omit<EsPhraseResult, 'format'>;

/**
 * The phrases a query did not find at their expected element alone: missed
 * there, or hit another element as well.
 */
export const esPositionProblems = (
  results: readonly EsPhraseResult[],
): EsPositionProblem[] =>
  results
    .filter((r) => !isOnTarget(r))
    .map(({ format: _, ...problem }) => problem);
