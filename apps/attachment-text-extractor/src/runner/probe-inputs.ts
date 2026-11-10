// The files the readiness probe converts in real children. A conversion child
// loads only the components of its own route (research.md 27.4), so together
// the routes must cover every third-party package the conversion layer
// imports: the PDF loads @embedpdf/pdfium; the PPTX loads yauzl, yazl,
// @xmldom/xmldom and @firecrawl/anydoc; the HTML loads htmlparser2 and
// entities. readiness-dependencies.integ.ts blocks each package in turn.
import type { ConversionLimits } from '../contract';
import { PROBE_PPTX } from './probe-pptx';

const MIB = 1024 * 1024;

/** Sized for these files alone, never the operator's settings. */
export const PROBE_LIMITS: ConversionLimits = {
  maxXlsxCells: 1_000,
  maxPdfPages: 1,
  maxArchiveEntries: 100,
  maxArchiveUncompressedBytes: MIB,
  maxResultBytes: MIB,
  maxCsvBytes: MIB,
  maxHtmlBytes: MIB,
};

export const PROBE_MAX_INPUT_BYTES = MIB;

export interface ProbeInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly mimeHint: string;
  /** Text the conversion must return; any other outcome means not ready. */
  readonly expectedText: string;
}

const PROBE_TEXT = 'readiness probe';

/** One page with one line of Helvetica text, cross-reference offsets included. */
const buildProbePdf = (text: string): Buffer => {
  const content = `BT /F1 12 Tf 10 20 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 50] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  const header = '%PDF-1.4\n';
  const bodies = objects.map(
    (object, i) => `${i + 1} 0 obj\n${object}\nendobj\n`,
  );
  // Latin-1 text: one character is one byte, so lengths are byte offsets.
  let xrefAt = header.length;
  const rows = bodies
    .map((body) => {
      const offset = xrefAt;
      xrefAt += body.length;
      return `${String(offset).padStart(10, '0')} 00000 n \n`;
    })
    .join('');
  const size = bodies.length + 1;
  const xref = `xref\n0 ${size}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(`${header}${bodies.join('')}${xref}`, 'latin1');
};

export const PROBE_INPUTS: readonly ProbeInput[] = [
  {
    bytes: buildProbePdf(PROBE_TEXT),
    fileName: 'probe.pdf',
    mimeHint: 'application/pdf',
    expectedText: PROBE_TEXT,
  },
  {
    bytes: PROBE_PPTX,
    fileName: 'probe.pptx',
    mimeHint:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    expectedText: PROBE_TEXT,
  },
  {
    // The character reference is decoded through entities.
    bytes: Buffer.from(
      `<!doctype html><html><head><title>probe</title></head><body><p>${PROBE_TEXT} &amp; ok</p></body></html>`,
      'utf8',
    ),
    fileName: 'probe.html',
    mimeHint: 'text/html',
    expectedText: `${PROBE_TEXT} & ok`,
  },
];
