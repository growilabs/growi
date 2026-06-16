import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Contract test for the dev/CI native-TS resolve hook.
 *
 * The hook is a process-global `module.registerHooks` side effect, so it is
 * exercised the way it is actually used at runtime: a child `node --import
 * <resolver> <entry>.ts` process whose stdout reports whether resolution
 * succeeded. This tests the observable contract (a specifier resolves and the
 * program runs) rather than the internal string matching.
 *
 * Regression guard for esm-import-convention: the codemod collapses
 * `./index.js` -> bare `.` (and `../x/index.js` -> `..`), which Node's native
 * ESM loader rejects with ERR_UNSUPPORTED_DIR_IMPORT. The resolver must map
 * those bare directory specifiers to the directory's index source, mirroring
 * the production-side `bin/add-js-extensions.mjs`.
 */
const RESOLVER = resolve(__dirname, 'dev-esm-resolver.mjs');

describe('dev-esm-resolver: directory import resolution', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dev-esm-resolver-'));
    // A package directory whose index the bare specifiers must resolve to.
    mkdirSync(join(dir, 'pkg'));
    writeFileSync(
      join(dir, 'pkg', 'index.ts'),
      'export const fromIndex = "INDEX_OK";\n',
    );
    // Leaf in the same directory importing it via bare '.'.
    writeFileSync(
      join(dir, 'pkg', 'leaf.ts'),
      "import { fromIndex } from '.';\nconsole.log(fromIndex);\n",
    );
    // Child in a subdirectory importing the parent via bare '..'.
    mkdirSync(join(dir, 'pkg', 'sub'));
    writeFileSync(
      join(dir, 'pkg', 'sub', 'child.ts'),
      "import { fromIndex } from '..';\nconsole.log('CHILD_' + fromIndex);\n",
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (entry: string): string =>
    execFileSync('node', ['--import', RESOLVER, entry], { encoding: 'utf8' });

  it("resolves a bare '.' specifier to the directory's index source", () => {
    expect(run(join(dir, 'pkg', 'leaf.ts'))).toContain('INDEX_OK');
  });

  it("resolves a bare '..' specifier to the parent directory's index source", () => {
    expect(run(join(dir, 'pkg', 'sub', 'child.ts'))).toContain(
      'CHILD_INDEX_OK',
    );
  });

  it('still resolves an extensionless relative file specifier', () => {
    writeFileSync(
      join(dir, 'pkg', 'value.ts'),
      'export const v = "VALUE_OK";\n',
    );
    writeFileSync(
      join(dir, 'pkg', 'uses-relative.ts'),
      "import { v } from './value';\nconsole.log(v);\n",
    );
    expect(run(join(dir, 'pkg', 'uses-relative.ts'))).toContain('VALUE_OK');
  });
});
