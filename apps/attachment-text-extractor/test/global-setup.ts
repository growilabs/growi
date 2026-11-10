// vitest globalSetup: rebuilds dist/ once before any test runs, so the runner's
// default child (dist/child/child-entry.js) is always the current src/, run
// without a TypeScript loader (research.md 23.5, decisions 3 and 4).
//
// The same steps as package.json's `build` script; keep the two in step.
// `pnpm run build` is not called: pnpm may start its own install, which
// collides with any other pnpm running at the same time.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { addJsExtensions } from '../scripts/add-js-extensions';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const DIST = path.join(PACKAGE_ROOT, 'dist');

export const setup = (): void => {
  rmSync(DIST, { recursive: true, force: true });
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const compiled = spawnSync(
    process.execPath,
    [tsc, '-p', 'tsconfig.build.json'],
    { cwd: PACKAGE_ROOT, encoding: 'utf8' },
  );
  if (compiled.status !== 0) {
    throw new Error(
      `building dist/ failed:\n${compiled.stdout}${compiled.stderr}`,
    );
  }
  const { unresolved } = addJsExtensions(DIST);
  if (unresolved.length > 0) {
    throw new Error(
      `dist/ has specifiers with no file:\n${unresolved.join('\n')}`,
    );
  }
};
