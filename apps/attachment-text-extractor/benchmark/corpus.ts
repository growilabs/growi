import type { BenchmarkAnswers } from './answers';
import type { GeneratedDocument } from './corpus-document';
import { OFFICE_DOCUMENTS } from './office-documents';
import { CHROMIUM_PDF_DOCUMENTS } from './pdf-documents';
import { TEXT_DOCUMENTS } from './text-documents';

// The single declaration of the corpus: generate-corpus writes the files and
// answers.json from it, and the drift spec compares answers.json against it.

export const GENERATED_DOCUMENTS: readonly GeneratedDocument[] = [
  ...TEXT_DOCUMENTS,
  ...OFFICE_DOCUMENTS,
];

export const declaredAnswers = (): BenchmarkAnswers => ({
  version: 1,
  documents: [...CHROMIUM_PDF_DOCUMENTS, ...GENERATED_DOCUMENTS].map(
    (document) => document.answer,
  ),
});
