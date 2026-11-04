import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BENCHMARK_ANSWERS_PATH, BENCHMARK_CORPUS_DIR } from './answers';
import { loadBenchmarkFont } from './benchmark-font';
import { declaredAnswers, GENERATED_DOCUMENTS } from './corpus';
import { CHROMIUM_PDF_DOCUMENTS } from './pdf-documents';
import { renderPdfs } from './render-pdf';

// Writes benchmark/corpus/ and benchmark/answers.json from the declarations
// (`pnpm benchmark:generate`). `--without-pdf` keeps the committed PDFs, for a
// machine without Chromium.

const withoutPdf = process.argv.includes('--without-pdf');

const buildPdfs = async (): Promise<[string, Uint8Array][]> => {
  const pdfs = await renderPdfs(
    CHROMIUM_PDF_DOCUMENTS,
    await loadBenchmarkFont(),
  );
  return CHROMIUM_PDF_DOCUMENTS.map(({ answer }, i) => [
    answer.fileName,
    pdfs[i],
  ]);
};

const removeUndeclaredFiles = async (declared: ReadonlySet<string>) => {
  const stale = (await readdir(BENCHMARK_CORPUS_DIR)).filter(
    (name) => !name.startsWith('.') && !declared.has(name),
  );
  await Promise.all(stale.map((name) => rm(join(BENCHMARK_CORPUS_DIR, name))));
  return stale;
};

const main = async () => {
  await mkdir(BENCHMARK_CORPUS_DIR, { recursive: true });
  const answers = declaredAnswers();
  const removed = await removeUndeclaredFiles(
    new Set(answers.documents.map((document) => document.fileName)),
  );
  const files: [string, Uint8Array][] = [
    ...(withoutPdf ? [] : await buildPdfs()),
    ...GENERATED_DOCUMENTS.map(({ answer, build }): [string, Uint8Array] => [
      answer.fileName,
      build(),
    ]),
  ];
  await Promise.all([
    ...files.map(([name, bytes]) =>
      writeFile(join(BENCHMARK_CORPUS_DIR, name), bytes),
    ),
    writeFile(BENCHMARK_ANSWERS_PATH, `${JSON.stringify(answers, null, 2)}\n`),
  ]);
  const report = [
    ...removed.map((name) => `removed ${name}`),
    ...files.map(([name, bytes]) => `${name}\t${bytes.length} bytes`),
    `answers.json\t${answers.documents.length} documents`,
  ];
  process.stdout.write(`${report.join('\n')}\n`);
};

await main();
