import { buildDocx, buildTextPdf } from '../../test/fixtures';

// The two documents the image check sends through POST /extract (Req 8.2),
// each with a marker the extracted text must hold.

export interface Sample {
  readonly fileName: string;
  readonly mimeType: string;
  readonly marker: string;
  readonly build: () => Buffer;
}

export const SAMPLES: readonly [Sample, ...Sample[]] = [
  {
    fileName: 'sample.pdf',
    mimeType: 'application/pdf',
    marker: 'Smoke PDF marker',
    build: () => buildTextPdf(['Smoke PDF marker']),
  },
  {
    fileName: 'sample.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    marker: 'Smoke DOCX marker',
    build: () => buildDocx(['Smoke DOCX marker']),
  },
];
