import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

import { BENCHMARK_CORPUS_DIR, loadBenchmarkAnswers } from './answers';
import { runBenchmark } from './benchmark-run';
import { deleteIndex } from './elasticsearch';
import { renderMarkdownReport } from './report-markdown';
import { parseRunOptions, RUN_USAGE } from './run-options';

// `pnpm benchmark`: sends the corpus to an extraction service's POST /extract
// and prints per-format, per-metric tables (requirements Req 2.9, 2.10).
// Point it at the Python service (research.md 8) or the Node one, e.g.
//
//   BENCHMARK_TOKEN=... pnpm benchmark --url http://127.0.0.1:18000 \
//     --label python --es-url http://elasticsearch:9200 --json out.json
//
// The metrics and their rules are in research.md 12.

const main = async (): Promise<void> => {
  const options = (() => {
    try {
      return parseRunOptions(process.argv.slice(2), process.env, (path) =>
        readFileSync(path, 'utf8'),
      );
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n\n${RUN_USAGE}\n`,
      );
      process.exit(2);
    }
  })();

  // Lower-case only, as index names must be; never derived from the label.
  const indexName = `benchmark-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const esUrl = options.esUrl;
  if (esUrl != null) {
    process.once('SIGINT', () => {
      deleteIndex(esUrl, indexName).finally(() => process.exit(130));
    });
  }

  const report = await runBenchmark({
    answers: loadBenchmarkAnswers(),
    corpusDir: BENCHMARK_CORPUS_DIR,
    endpoint: {
      baseUrl: options.serviceUrl,
      token: options.token,
      timeoutMs: options.timeoutMs,
    },
    label: options.label,
    ...(esUrl == null ? {} : { elasticsearch: { url: esUrl, indexName } }),
  });

  process.stdout.write(renderMarkdownReport(report));
  if (options.jsonPath != null) {
    await writeFile(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(`wrote ${options.jsonPath}\n`);
  }
};

await main();
