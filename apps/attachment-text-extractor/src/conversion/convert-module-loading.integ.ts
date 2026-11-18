import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildDocx,
  PLAIN_DOCUMENTS,
  SPEC_TMP_PREFIX,
} from '../../test/fixtures';

// A child converts one file per process, so whatever the route loads stays in
// its RSS. The PDF route must not load anydoc, the text family or the OOXML
// layer, and no other route may load PDFium (memory budget, research.md 27.3).

const here = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(here, 'spec-support', 'loaded-modules-child.mjs');
const ENTRY = path.join(here, 'index.ts');
const CONVERSION_URL = new URL('./', import.meta.url).href;

interface Loads {
  readonly kind: string;
  /** Modules of this package, as paths under src/conversion/. */
  readonly ownModules: readonly string[];
  readonly externalModules: readonly string[];
  readonly nativeAddons: readonly string[];
}

const runChild = promisify(execFile);

let workDir = '';

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), `${SPEC_TMP_PREFIX}loads-`));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const convertInFreshProcess = async (
  bytes: Uint8Array,
  fileName: string,
): Promise<Loads> => {
  const file = path.join(workDir, fileName);
  writeFileSync(file, bytes);
  const { stdout } = await runChild(process.execPath, [CHILD, file, fileName], {
    timeout: 60_000,
  });
  const report: {
    kind: string;
    loaded: string[];
    mappedFiles: string[];
  } = JSON.parse(stdout);
  return {
    kind: report.kind,
    ownModules: report.loaded
      .filter((url) => url.startsWith(CONVERSION_URL))
      .map((url) => url.slice(CONVERSION_URL.length)),
    externalModules: report.loaded.filter((url) =>
      url.includes('/node_modules/'),
    ),
    nativeAddons: report.mappedFiles.filter((file) => file.endsWith('.node')),
  };
};

const fromPackage = (urls: readonly string[], name: string): boolean =>
  urls.some((url) => url.includes(`/node_modules/${name}/`));

describe.skipIf(process.platform !== 'linux')(
  'modules loaded by one conversion in a fresh process',
  () => {
    it('keeps the entry the child process imports', () => {
      expect(existsSync(ENTRY)).toBe(true);
    });

    it('loads PDFium, but not anydoc, the text family or the OOXML layer, for a PDF', async () => {
      const loads = await convertInFreshProcess(
        PLAIN_DOCUMENTS.pdfText.build(),
        'a.pdf',
      );

      expect(loads.kind).toBe('ok');
      expect(loads.ownModules).toContain('pdf.ts');
      expect(fromPackage(loads.externalModules, '@embedpdf/pdfium')).toBe(true);
      expect(fromPackage(loads.externalModules, '@firecrawl/anydoc')).toBe(
        false,
      );
      expect(loads.nativeAddons).toEqual([]);
      // normalize.ts shares the batched replace with the text family.
      expect(
        loads.ownModules.filter(
          (module) =>
            module === 'office.ts' ||
            module.startsWith('ooxml/') ||
            (module.startsWith('text/') &&
              module !== 'text/replace-batched.ts'),
        ),
      ).toEqual([]);
    });

    it('does not load PDFium for a DOCX', async () => {
      const loads = await convertInFreshProcess(buildDocx(['本文']), 'a.docx');

      expect(loads.kind).toBe('ok');
      expect(loads.ownModules).toContain('office.ts');
      expect(fromPackage(loads.externalModules, '@embedpdf/pdfium')).toBe(
        false,
      );
      expect(
        loads.ownModules.filter(
          (module) => module === 'pdf.ts' || module.startsWith('pdfium/'),
        ),
      ).toEqual([]);
    });
  },
);
