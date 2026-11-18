import type { DocumentAnswer } from '../answers';
import type { ExtractOutcome } from '../extraction';
import { mapSequentially } from '../map-sequentially';
import {
  analyzeTokens,
  bulkIndex,
  createIndex,
  deleteIndex,
  fetchPlugins,
  search,
} from './es-client';
import {
  bulkBody,
  ES_QUERY_VARIANTS,
  type EsPhraseResult,
  type EsPlugins,
  hitElementIndexes,
  indexBody,
  japaneseAnalyzer,
  phraseQuery,
} from './es-queries';

export const ANALYZE_SAMPLE_TEXT = '基幹システムの本格稼働';

export interface EsProbe {
  readonly plugins: EsPlugins;
  /** kuromoji's tokens for a sample sentence; empty without kuromoji. */
  readonly analyzeSample: readonly string[];
}

/** Which analysis plugins there are, and whether kuromoji really tokenizes. */
export const probeElasticsearch = async (url: string): Promise<EsProbe> => {
  const plugins = await fetchPlugins(url);
  return {
    plugins,
    analyzeSample: plugins.kuromoji
      ? await analyzeTokens(url, japaneseAnalyzer(plugins), ANALYZE_SAMPLE_TEXT)
      : [],
  };
};

export interface EsMeasureInput {
  readonly url: string;
  /** A throwaway index; it is deleted before this returns or throws. */
  readonly indexName: string;
  readonly plugins: EsPlugins;
  readonly documents: readonly {
    readonly answer: DocumentAnswer;
    readonly outcome: ExtractOutcome;
  }[];
}

const indexAndSearch = async ({
  url,
  indexName,
  plugins,
  documents,
}: EsMeasureInput): Promise<EsPhraseResult[]> => {
  await createIndex(url, indexName, indexBody(plugins));
  const extracted = documents.flatMap(({ answer, outcome }) =>
    outcome.ok ? [{ fileName: answer.fileName, pages: outcome.pages }] : [],
  );
  const ndjson = bulkBody(extracted);
  if (ndjson !== '') {
    await bulkIndex(url, indexName, ndjson);
  }
  const queries = documents.flatMap(({ answer, outcome }) =>
    answer.phrases.flatMap((phrase) =>
      ES_QUERY_VARIANTS.map((variant) => ({
        answer,
        outcome,
        phrase,
        variant,
      })),
    ),
  );
  // One query at a time keeps the load on a shared cluster small.
  return await mapSequentially(
    queries,
    async ({ answer, outcome, phrase, variant }): Promise<EsPhraseResult> => ({
      fileName: answer.fileName,
      text: phrase.text,
      format: answer.format,
      variant,
      page: phrase.page,
      elementIndexes: outcome.ok
        ? hitElementIndexes(
            await search(
              url,
              indexName,
              phraseQuery(variant, answer.fileName, phrase.text),
            ),
          )
        : [],
    }),
  );
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Indexes every extracted element, then searches each expected phrase within
 * its document with every query variant. A failed document is not indexed,
 * so its phrases are not found. The index is deleted either way; when the
 * measurement failed, its error wins over a failure to delete.
 */
export const measureEsRecall = async (
  input: EsMeasureInput,
): Promise<EsPhraseResult[]> => {
  const measured = await indexAndSearch(input).then(
    (results) => ({ ok: true as const, results }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  if (measured.ok) {
    await deleteIndex(input.url, input.indexName);
    return measured.results;
  }
  const cleanupError = await deleteIndex(input.url, input.indexName).then(
    () => null,
    (error: unknown) => error,
  );
  if (cleanupError == null) {
    throw measured.error;
  }
  throw new Error(
    `${messageOf(measured.error)}; deleting the index ${input.indexName} also failed: ${messageOf(cleanupError)}`,
    { cause: measured.error },
  );
};
