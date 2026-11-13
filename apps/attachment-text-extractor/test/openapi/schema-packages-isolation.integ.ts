import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  type ChildEntry,
  createConversionRunner,
} from '../../src/runner/conversion-runner';
import {
  killStrayChildren,
  runnerOptions,
  within,
} from '../../src/runner/spec-support';

// The packages that build the OpenAPI document (hono-openapi, zod) stay in
// the parent's HTTP layer: the child and the conversion layer never load them
// (design.md judgement 1, task 6.9). Checked on the built dist/ the child
// runs, with a resolve hook that makes one package impossible to import:
// (1) the readiness probe child, which runs every external conversion
// package, stays ready; (2) every module the child can reach, dynamic
// per-route imports included, imports cleanly.

const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIST = path.join(PACKAGE_ROOT, 'dist');
const HOOK_URL = pathToFileURL(
  path.join(PACKAGE_ROOT, 'src/runner/spec-support/block-import-hook.mjs'),
);
const SCHEMA_PACKAGES = ['zod', 'hono-openapi'] as const;
const run = promisify(execFile);

const blockingHook = (specifier: string): string => {
  const hook = new URL(HOOK_URL);
  hook.searchParams.set('blocked', specifier);
  return hook.href;
};

// child-entry.js is left out: it runs the child on import. Its own imports
// are what the readiness case loads.
const CHILD_SIDE_MODULES = [
  'child',
  'conversion',
  'contract',
  'formats',
  'wire',
]
  .flatMap((dir) =>
    readdirSync(path.join(DIST, dir), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.js'))
      .map((file) => path.join(DIST, dir, file)),
  )
  .filter((file) => path.basename(file) !== 'child-entry.js');

const importAllWithout = (specifier: string) =>
  run(process.execPath, [
    '--import',
    blockingHook(specifier),
    '--input-type=module',
    '--eval',
    `for (const file of ${JSON.stringify(CHILD_SIDE_MODULES)}) await import(file);`,
  ]);

describe.skipIf(process.platform !== 'linux')(
  'the child does not load the OpenAPI packages',
  { timeout: 60_000 },
  () => {
    afterEach(killStrayChildren);

    it('reaches the conversion modules (a walk that found nothing would pass)', () => {
      expect(CHILD_SIDE_MODULES).toContain(
        path.join(DIST, 'conversion', 'convert.js'),
      );
      expect(CHILD_SIDE_MODULES).toContain(
        path.join(DIST, 'conversion', 'ooxml', 'xlsx-split.js'),
      );
    });

    it.each(
      SCHEMA_PACKAGES,
    )('the probe child is ready while %s cannot be imported', async (specifier) => {
      const childEntry: ChildEntry = {
        path: path.join(DIST, 'child', 'child-entry.js'),
        nodeArgs: ['--import', blockingHook(specifier)],
      };
      const runner = createConversionRunner(runnerOptions({ childEntry }));

      expect((await within(runner.readiness())).ready).toBe(true);
    });

    it.each(
      SCHEMA_PACKAGES,
    )('every module the child can load imports while %s cannot be imported', async (specifier) => {
      await expect(importAllWithout(specifier)).resolves.toBeDefined();
    });

    // Without this case, the passes above could come from a hook that blocks nothing.
    it('fails to import those modules when a package they use is blocked', async () => {
      await expect(importAllWithout('@xmldom/xmldom')).rejects.toThrow(
        /blocked by the test/,
      );
    });
  },
);
