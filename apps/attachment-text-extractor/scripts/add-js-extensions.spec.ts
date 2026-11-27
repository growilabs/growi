import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEC_TMP_PREFIX } from '../test/fixtures/tmp-prefix';
import { addJsExtensions } from './add-js-extensions';

// tsc copies extensionless relative specifiers into dist as they are, and
// Node's ESM loader does not search for extensions; this step makes dist
// runnable (research.md 23.5).

const SCRIPT = fileURLToPath(
  new URL('./add-js-extensions.ts', import.meta.url),
);

let dist = '';

beforeEach(() => {
  dist = mkdtempSync(path.join(tmpdir(), `${SPEC_TMP_PREFIX}dist-`));
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

const write = (relative: string, content: string): void => {
  const file = path.join(dist, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

/** A small dist tree using each specifier form tsc emits from this package. */
const writeTree = (): void => {
  write('package.json', '{"type":"module"}');
  write(
    'main.js',
    [
      "import { readFileSync } from 'node:fs';",
      "import { lib } from './lib';",
      "import './side-effect';",
      "export { nested } from './nested/deep';",
      "const { index } = await import('./dir');",
      "const { already } = await import('./already.js');",
      'console.log([typeof readFileSync, lib, index, already, globalThis.sideEffect].join(" "));',
    ].join('\n'),
  );
  write('lib.js', "export const lib = 'lib';");
  write('side-effect.js', 'globalThis.sideEffect = "side";');
  write('nested/deep.js', "export { lib as nested } from '../lib';");
  write('dir/index.js', "export const index = 'index';");
  write('already.js', "export const already = 'already';");
};

const runMain = () =>
  spawnSync(process.execPath, [path.join(dist, 'main.js')], {
    encoding: 'utf8',
  });

describe('addJsExtensions', () => {
  it('makes a tree of extensionless relative imports runnable by node', () => {
    writeTree();
    expect(runMain().status).not.toBe(0);

    const result = addJsExtensions(dist);

    expect(result.unresolved).toEqual([]);
    const ran = runMain();
    expect(ran.stderr).toBe('');
    expect(ran.stdout.trim()).toBe('function lib index already side');
  });

  it('is idempotent: a second pass rewrites nothing', () => {
    writeTree();
    addJsExtensions(dist);

    expect(addJsExtensions(dist)).toEqual({ rewritten: 0, unresolved: [] });
    expect(runMain().status).toBe(0);
  });

  it('reports a relative specifier that resolves to no file', () => {
    write('main.js', "import { gone } from './gone';");

    const result = addJsExtensions(dist);

    expect(result.unresolved).toEqual([
      `${path.join(dist, 'main.js')}: './gone'`,
    ]);
  });

  it('fails the build from the command line when a specifier is unresolved', () => {
    write('main.js', "import { gone } from './gone';");

    const ran = spawnSync(process.execPath, [SCRIPT, dist], {
      encoding: 'utf8',
    });

    expect(ran.status).toBe(1);
  });

  it('succeeds from the command line on a resolvable tree', () => {
    writeTree();

    const ran = spawnSync(process.execPath, [SCRIPT, dist], {
      encoding: 'utf8',
    });

    expect(ran.status).toBe(0);
    expect(runMain().status).toBe(0);
  });
});
