import {
  buildOneSheetAtCellLimitXlsx,
  buildTwelveImagesDocx,
} from '../../../test/fixtures';
import { buildPdf } from '../../../test/fixtures/pdf';
import {
  answerProblems,
  type BaselineFile,
  type ExpectedAnswer,
  type Scenario,
} from './report';

// The inputs and the loads of the memory measurement (research.md 20.7a,
// 20.12; tasks 6.12).

export interface Upload extends ExpectedAnswer {
  readonly data: Buffer;
}

export interface Service {
  readonly baseUrl: string;
  readonly token: string;
}

const CONCURRENCY = 3;
const MIB = 1024 * 1024;

// 5.5 million control characters: six bytes each in JSON, a ~33 MB result.
const controlText = (): Upload => ({
  fileName: 'control.txt',
  data: Buffer.alloc(5_500_000, 0x01),
  expectedStatus: 200,
});

// 8 MiB of one-character cells (about 4.2 million): the child grows until
// the RSS watch stops it. The marker is the start of that failure's message
// (src/http/error-table.ts); any other 422 is not this load.
const growingCsv = (): Upload => ({
  fileName: 'growing.csv',
  data: Buffer.alloc(8 * MIB, `${'a,'.repeat(999)}a\n`),
  expectedStatus: 422,
  expectedInBody: 'memory_exceeded',
});

/**
 * Sends the upload and reads the answer to its end; the body is kept only
 * when the upload expects a marker in it.
 */
const send = async (
  { baseUrl, token }: Service,
  upload: Upload,
): Promise<readonly string[]> => {
  const { fileName, data, expectedInBody } = upload;
  const form = new FormData();
  // A copy: Blob takes no view over a possibly shared buffer.
  form.append('file', new Blob([new Uint8Array(data)]), fileName);
  const response = await fetch(`${baseUrl}/extract`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (expectedInBody === undefined) {
    await response.arrayBuffer();
    return answerProblems(upload, response.status, null);
  }
  return answerProblems(upload, response.status, await response.text());
};

const atOnce = async (
  service: Service,
  upload: Upload,
): Promise<readonly string[]> =>
  (
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () => send(service, upload)),
    )
  ).flat();

/** Each batch is three uploads at once; the batches follow one another. */
const inTurn = async (
  service: Service,
  batches: readonly Upload[],
): Promise<readonly string[]> => {
  const unexpected: string[] = [];
  for (const upload of batches) {
    unexpected.push(...(await atOnce(service, upload)));
  }
  return unexpected;
};

/** Runs the load; returns the requests that did not end as intended. */
export const LOADS: Readonly<
  Record<Scenario, (service: Service) => Promise<readonly string[]>>
> = {
  // Three ~33 MB results at once, three times.
  S1: (service) => inTurn(service, Array(3).fill(controlText())),
  // The same three results, then three growing children, four times over.
  S2: (service) =>
    inTurn(
      service,
      Array.from({ length: 4 }, () => [controlText(), growingCsv()]).flat(),
    ),
};

const twoMillionCharacterPdf = (): Buffer =>
  buildPdf([
    {
      resources: '<< /Font << /F1 3 0 R >> >>',
      content: `BT /F1 1 Tf 72 700 Td\n${`(${'a'.repeat(1000)}) Tj 0 -1 Td\n`.repeat(2000)}ET`,
    },
  ]);

export const BASELINE_UPLOADS: Readonly<Record<BaselineFile, () => Upload>> = {
  'xlsx-70000-cells': () => ({
    fileName: 'baseline.xlsx',
    data: buildOneSheetAtCellLimitXlsx(),
    expectedStatus: 200,
  }),
  'docx-12-images-48mb': () => ({
    fileName: 'baseline.docx',
    data: buildTwelveImagesDocx(),
    expectedStatus: 200,
  }),
  'pdf-2-million-characters': () => ({
    fileName: 'baseline.pdf',
    data: twoMillionCharacterPdf(),
    expectedStatus: 200,
  }),
};

export const sendOne = send;
