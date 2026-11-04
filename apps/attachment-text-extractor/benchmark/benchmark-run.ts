import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  BenchmarkAnswers,
  BenchmarkFormat,
  DocumentAnswer,
} from './answers';
import {
  type EsFormatRecall,
  type EsPlugins,
  type EsPositionProblem,
  esPositionProblems,
  esRecallAll,
  esRecallByFormat,
  measureEsRecall,
  probeElasticsearch,
} from './elasticsearch';
import { type ExtractEndpoint, extractDocument } from './extract-client';
import type { ExtractOutcome } from './extraction';
import { mapSequentially } from './map-sequentially';
import {
  type DocumentScore,
  type FormatSummary,
  scoreDocument,
  summarizeAll,
  summarizeByFormat,
} from './scoring';

export interface CorpusFileRecord {
  readonly fileName: string;
  readonly format: BenchmarkFormat;
  readonly bytes: number;
  readonly sha256: string;
}

export type EsReport =
  | { readonly status: 'skipped'; readonly reason: string }
  | {
      readonly status: 'measured';
      readonly url: string;
      readonly plugins: EsPlugins;
      readonly analyzeSample: readonly string[];
      readonly indexName: string;
      readonly recall: readonly EsFormatRecall[];
      /** Phrases a query did not find at their expected element alone. */
      readonly positionProblems: readonly EsPositionProblem[];
    };

export interface BenchmarkReport {
  readonly label: string;
  /** The service URL (run-options refuses one with credentials). */
  readonly service: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly corpus: readonly CorpusFileRecord[];
  readonly formats: readonly FormatSummary[];
  readonly total: FormatSummary;
  readonly documents: readonly DocumentScore[];
  readonly elasticsearch: EsReport;
}

export interface BenchmarkRunOptions {
  readonly answers: BenchmarkAnswers;
  readonly corpusDir: string;
  readonly endpoint: ExtractEndpoint;
  readonly label: string;
  /** Omitted: the Elasticsearch stage is skipped. */
  readonly elasticsearch?: { readonly url: string; readonly indexName: string };
  readonly now?: () => Date;
}

interface Measured {
  readonly answer: DocumentAnswer;
  readonly record: CorpusFileRecord;
  readonly outcome: ExtractOutcome;
}

const measureDocument = async (
  options: BenchmarkRunOptions,
  answer: DocumentAnswer,
): Promise<Measured> => {
  const bytes = await readFile(join(options.corpusDir, answer.fileName));
  return {
    answer,
    record: {
      fileName: answer.fileName,
      format: answer.format,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    outcome: await extractDocument(options.endpoint, {
      fileName: answer.fileName,
      mimeType: answer.mimeType,
      bytes,
    }),
  };
};

// One document at a time: a parallel burst would meet the service's
// concurrency limit (429 / 503) and blur the measurement.
const measureAll = (
  options: BenchmarkRunOptions,
): Promise<readonly Measured[]> =>
  mapSequentially(options.answers.documents, (answer) =>
    measureDocument(options, answer),
  );

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const measureElasticsearch = async (
  options: BenchmarkRunOptions,
  measured: readonly Measured[],
): Promise<EsReport> => {
  const es = options.elasticsearch;
  if (es == null) {
    return { status: 'skipped', reason: 'no Elasticsearch URL was given' };
  }
  try {
    const probe = await probeElasticsearch(es.url);
    if (!probe.plugins.kuromoji) {
      return {
        status: 'skipped',
        reason: 'Elasticsearch has no analysis-kuromoji plugin',
      };
    }
    const results = await measureEsRecall({
      url: es.url,
      indexName: es.indexName,
      plugins: probe.plugins,
      documents: measured,
    });
    return {
      status: 'measured',
      url: es.url,
      plugins: probe.plugins,
      analyzeSample: probe.analyzeSample,
      indexName: es.indexName,
      recall: [...esRecallByFormat(results), ...esRecallAll(results)],
      positionProblems: esPositionProblems(results),
    };
  } catch (error) {
    return {
      status: 'skipped',
      reason: `Elasticsearch failed: ${errorMessage(error)}`,
    };
  }
};

/** Sends every corpus document to the service, scores it, and reports. */
export const runBenchmark = async (
  options: BenchmarkRunOptions,
): Promise<BenchmarkReport> => {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const measured = await measureAll(options);
  const documents = measured.map(({ answer, outcome }) =>
    scoreDocument(answer, outcome),
  );
  const elasticsearch = await measureElasticsearch(options, measured);
  return {
    label: options.label,
    service: options.endpoint.baseUrl,
    startedAt,
    finishedAt: now().toISOString(),
    corpus: measured.map(({ record }) => record),
    formats: summarizeByFormat(documents),
    total: summarizeAll(documents),
    documents,
    elasticsearch,
  };
};
