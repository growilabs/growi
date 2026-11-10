import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { type ChildEntry, createConversionRunner } from './conversion-runner';
import { killStrayChildren, runnerOptions, within } from './spec-support';

// Req 8.8 and research.md 20.12 / 27.6: the readiness probe must load every
// external conversion package, whatever a single conversion would load (a PDF
// child loads PDFium only, an HTML child neither anydoc nor PDFium). Python test_main.py
// test_missing_dependency_boots_not_ready_and_readyz_gives_503: a child that
// cannot import one conversion component is not ready.
// The probe runs the real built child (dist/, research.md 23.5), with a resolve
// hook that makes one package impossible to import.

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_CHILD_ENTRY = path.resolve(here, '../../dist/child/child-entry.js');
const HOOK_URL = pathToFileURL(
  path.join(here, 'spec-support', 'block-import-hook.mjs'),
);

const childBlocking = (specifier: string): ChildEntry => {
  const hook = new URL(HOOK_URL);
  hook.searchParams.set('blocked', specifier);
  return { path: DIST_CHILD_ENTRY, nodeArgs: ['--import', hook.href] };
};

const readinessWith = async (childEntry: ChildEntry): Promise<boolean> => {
  const runner = createConversionRunner(runnerOptions({ childEntry }));
  return (await within(runner.readiness())).ready;
};

describe.skipIf(process.platform !== 'linux')(
  'readiness when a conversion component cannot be loaded',
  { timeout: 60_000 },
  () => {
    afterEach(killStrayChildren);

    // Without this case, "not ready" below could come from the hook itself.
    it('is ready when the hook blocks a package the child never imports', async () => {
      expect(await readinessWith(childBlocking('no-such-package-7d2e'))).toBe(
        true,
      );
    });

    // Every third-party package the conversion layer imports.
    it.each([
      '@firecrawl/anydoc',
      '@embedpdf/pdfium',
      'yauzl',
      'yazl',
      '@xmldom/xmldom',
      'htmlparser2',
      'entities',
    ])('is not ready when the child cannot import %s', async (specifier) => {
      expect(await readinessWith(childBlocking(specifier))).toBe(false);
    });

    // Python's probe only checked what was loaded. Limits an operator may
    // validly set must not make every pod not ready.
    it('stays ready under conversion limits that refuse the probe files', async () => {
      const options = runnerOptions();
      const runner = createConversionRunner({
        ...options,
        limits: {
          ...options.limits,
          maxPdfPages: 0,
          maxCsvBytes: 1,
          maxResultBytes: 1,
        },
        maxInputBytes: 0,
      });

      expect((await within(runner.readiness())).ready).toBe(true);
    });
  },
);
