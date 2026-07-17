/**
 * Tests for the add-js-extensions post-build tool (C1, esm-import-convention task 2.1).
 *
 * The tool processes emitted .js files in dist and rewrites extensionless relative
 * import specifiers to the correct resolved form (.js / /index.js / .jsx).
 *
 * Test strategy (essential-test-design): verify the observable contract — output file
 * content and the returned summary object — not internal implementation details.
 * Fixtures are created in a temp directory per test.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { addJsExtensions } = await import('./add-js-extensions');

import type { AliasMapping } from './add-js-extensions';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'add-js-ext-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Create a file at `relPath` (relative to `tmpDir`) with the given content.
 */
function writeFile(relPath: string, content: string): void {
  const absPath = join(tmpDir, relPath);
  mkdirSync(join(tmpDir, relPath.split('/').slice(0, -1).join('/')), {
    recursive: true,
  });
  writeFileSync(absPath, content, 'utf8');
}

/**
 * Read a file from `tmpDir` and return its content.
 */
function readFile(relPath: string): string {
  return readFileSync(join(tmpDir, relPath), 'utf8');
}

// ──────────────────────────────────────────────────────────────────────────────
// Test cases — happy paths
// ──────────────────────────────────────────────────────────────────────────────

describe('add-js-extensions: extensionless relative → .js', () => {
  it('rewrites ./X to ./X.js when X.js exists next to the importer', () => {
    writeFile('a.js', `import { foo } from './b';`);
    writeFile('b.js', `export const foo = 1;`);

    const result = addJsExtensions(tmpDir);

    expect(readFile('a.js')).toContain(`from './b.js'`);
    expect(result.rewritten).toBe(1);
    expect(result.unresolved).toHaveLength(0);
  });

  it('rewrites ../X to ../X.js when X.js exists in the parent directory', () => {
    writeFile('sub/a.js', `import { foo } from '../b';`);
    writeFile('b.js', `export const foo = 1;`);

    addJsExtensions(tmpDir);

    expect(readFile('sub/a.js')).toContain(`from '../b.js'`);
  });

  it('handles multiple imports in the same file', () => {
    writeFile(
      'a.js',
      [`import { foo } from './b';`, `import { bar } from './c';`].join('\n'),
    );
    writeFile('b.js', `export const foo = 1;`);
    writeFile('c.js', `export const bar = 2;`);

    const result = addJsExtensions(tmpDir);

    expect(readFile('a.js')).toContain(`from './b.js'`);
    expect(readFile('a.js')).toContain(`from './c.js'`);
    expect(result.rewritten).toBe(2);
  });

  it('handles dynamic import() expressions', () => {
    writeFile('a.js', `const m = await import('./b');`);
    writeFile('b.js', `export const foo = 1;`);

    addJsExtensions(tmpDir);

    expect(readFile('a.js')).toContain(`import('./b.js')`);
  });
});

describe('add-js-extensions: directory → /index.js', () => {
  it('rewrites ./dir to ./dir/index.js when dir/index.js exists', () => {
    writeFile('a.js', `import { foo } from './sub';`);
    writeFile('sub/index.js', `export const foo = 1;`);

    addJsExtensions(tmpDir);

    expect(readFile('a.js')).toContain(`from './sub/index.js'`);
  });

  it('rewrites ./dir/ with trailing slash to ./dir/index.js', () => {
    writeFile('a.js', `import { foo } from './sub/';`);
    writeFile('sub/index.js', `export const foo = 1;`);

    addJsExtensions(tmpDir);

    // Trailing slash form resolves to sub/index.js
    expect(readFile('a.js')).toContain(`./sub/index.js`);
  });

  it("rewrites bare '.' to './index.js' when index.js exists in same dir", () => {
    // import { foo } from '.' — self-barrel (e.g. discriminator sub-models)
    writeFile('sub/a.js', `import { foo } from '.';`);
    writeFile('sub/index.js', `export const foo = 1;`);

    addJsExtensions(tmpDir);

    expect(readFile('sub/a.js')).toContain(`from './index.js'`);
  });
});

describe('add-js-extensions: .jsx target from .tsx client emit', () => {
  it('rewrites ./X to ./X.jsx when X.jsx exists (dead client emit)', () => {
    writeFile('a.js', `import React from './Widget';`);
    writeFile('Widget.jsx', `export default function Widget() {}`);

    addJsExtensions(tmpDir);

    expect(readFile('a.js')).toContain(`from './Widget.jsx'`);
  });

  it('rewrites ./dir to ./dir/index.jsx when dir/index.jsx exists', () => {
    writeFile('a.js', `import React from './ui';`);
    writeFile('ui/index.jsx', `export default function UI() {}`);

    addJsExtensions(tmpDir);

    expect(readFile('a.js')).toContain(`from './ui/index.jsx'`);
  });
});

describe('add-js-extensions: idempotency — already-extensioned specifiers are unchanged', () => {
  it('does not double-add .js to already .js specifier', () => {
    writeFile('a.js', `import { foo } from './b.js';`);
    writeFile('b.js', `export const foo = 1;`);

    const result = addJsExtensions(tmpDir);

    expect(readFile('a.js')).toBe(`import { foo } from './b.js';`);
    expect(result.rewritten).toBe(0);
  });

  it('does not modify .cjs specifiers', () => {
    writeFile('a.js', `import cfg from './config.cjs';`);
    writeFile('config.cjs', `module.exports = {};`);

    const result = addJsExtensions(tmpDir);

    expect(readFile('a.js')).toBe(`import cfg from './config.cjs';`);
    expect(result.rewritten).toBe(0);
  });

  it('is idempotent — running twice produces the same result', () => {
    writeFile('a.js', `import { foo } from './b';`);
    writeFile('b.js', `export const foo = 1;`);

    addJsExtensions(tmpDir);
    const afterFirst = readFile('a.js');
    addJsExtensions(tmpDir);
    const afterSecond = readFile('a.js');

    expect(afterFirst).toBe(afterSecond);
  });
});

describe('add-js-extensions: .json import attributes — unchanged', () => {
  it('does not modify .json imports even without explicit extension already', () => {
    // .json is not a TypeScript source — it keeps its extension
    writeFile('a.js', `import data from './data.json' with { type: 'json' };`);
    writeFile('data.json', `{"key":"value"}`);

    const result = addJsExtensions(tmpDir);

    expect(readFile('a.js')).toBe(
      `import data from './data.json' with { type: 'json' };`,
    );
    expect(result.rewritten).toBe(0);
  });
});

describe('add-js-extensions: unresolvable specifiers', () => {
  it('leaves an unresolvable specifier unchanged and reports it', () => {
    writeFile('a.js', `import { x } from './nonexistent';`);

    const result = addJsExtensions(tmpDir);

    // Content is unchanged
    expect(readFile('a.js')).toBe(`import { x } from './nonexistent';`);
    // Unresolved is reported
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toContain('nonexistent');
  });

  it('does not modify non-relative (external package) specifiers', () => {
    writeFile('a.js', `import mongoose from 'mongoose';`);

    const result = addJsExtensions(tmpDir);

    expect(readFile('a.js')).toBe(`import mongoose from 'mongoose';`);
    expect(result.rewritten).toBe(0);
    expect(result.unresolved).toHaveLength(0);
  });
});

describe('add-js-extensions: path-alias specifiers (~/, ^/) → relative', () => {
  /**
   * Alias rewriting replaces the emit-time transform previously done by
   * typescript-transform-paths (via tspc). Contract: an alias specifier is
   * rewritten to an importer-relative specifier pointing at the mapped target,
   * with the extension resolved against the real filesystem.
   */
  const distAliases = (): readonly AliasMapping[] => [
    { prefix: '~/', targetDir: tmpDir },
  ];

  it('rewrites ~/X to a relative specifier with .js from a nested importer', () => {
    writeFile('sub/a.js', `import { foo } from '~/lib/b';`);
    writeFile('lib/b.js', `export const foo = 1;`);

    const result = addJsExtensions(tmpDir, distAliases());

    expect(readFile('sub/a.js')).toContain(`from '../lib/b.js'`);
    expect(result.rewritten).toBe(1);
    expect(result.unresolved).toHaveLength(0);
  });

  it('rewrites ~/X to ./X.js when importer sits at dist root (leading ./ added)', () => {
    writeFile('a.js', `import { foo } from '~/b';`);
    writeFile('b.js', `export const foo = 1;`);

    addJsExtensions(tmpDir, distAliases());

    expect(readFile('a.js')).toContain(`from './b.js'`);
  });

  it('computes multi-level ../ for deeply nested importers', () => {
    writeFile('a/b/c.js', `import { foo } from '~/d/e';`);
    writeFile('d/e.js', `export const foo = 1;`);

    addJsExtensions(tmpDir, distAliases());

    expect(readFile('a/b/c.js')).toContain(`from '../../d/e.js'`);
  });

  it('rewrites ~/dir to a relative /index.js barrel', () => {
    writeFile('sub/a.js', `import { foo } from '~/lib';`);
    writeFile('lib/index.js', `export const foo = 1;`);

    addJsExtensions(tmpDir, distAliases());

    expect(readFile('sub/a.js')).toContain(`from '../lib/index.js'`);
  });

  it('rewrites alias in dynamic import() expressions', () => {
    writeFile('sub/a.js', `const m = await import('~/lib/b');`);
    writeFile('lib/b.js', `export const foo = 1;`);

    addJsExtensions(tmpDir, distAliases());

    expect(readFile('sub/a.js')).toContain(`import('../lib/b.js')`);
  });

  it('rewrites an already-extensioned alias specifier keeping its extension', () => {
    // Real case: server code imports ^/config/*.mjs — the alias maps outside
    // the dist tree and the .mjs extension must be preserved as-is.
    writeFile('dist/sub/a.js', `import cfg from '^/config/app.mjs';`);
    writeFile('config/app.mjs', `export default {};`);

    const result = addJsExtensions(join(tmpDir, 'dist'), [
      { prefix: '^/', targetDir: tmpDir },
    ]);

    expect(readFile('dist/sub/a.js')).toContain(`from '../../config/app.mjs'`);
    expect(result.rewritten).toBe(1);
    expect(result.unresolved).toHaveLength(0);
  });

  it('reports an unresolvable alias target and leaves it unchanged', () => {
    writeFile('a.js', `import { x } from '~/missing/mod';`);

    const result = addJsExtensions(tmpDir, distAliases());

    expect(readFile('a.js')).toBe(`import { x } from '~/missing/mod';`);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toContain('~/missing/mod');
  });

  it('leaves alias specifiers untouched when no alias mapping is given', () => {
    writeFile('a.js', `import { foo } from '~/b';`);
    writeFile('b.js', `export const foo = 1;`);

    const result = addJsExtensions(tmpDir);

    expect(readFile('a.js')).toBe(`import { foo } from '~/b';`);
    expect(result.rewritten).toBe(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it('is idempotent — a second run leaves alias-rewritten output unchanged', () => {
    writeFile('sub/a.js', `import { foo } from '~/lib/b';`);
    writeFile('lib/b.js', `export const foo = 1;`);

    addJsExtensions(tmpDir, distAliases());
    const afterFirst = readFile('sub/a.js');
    addJsExtensions(tmpDir, distAliases());
    const afterSecond = readFile('sub/a.js');

    expect(afterFirst).toBe(afterSecond);
  });
});

describe('add-js-extensions: return contract', () => {
  it('returns { rewritten: number, unresolved: string[] }', () => {
    writeFile('a.js', `import { foo } from './b';`);
    writeFile('b.js', `export const foo = 1;`);

    const result = addJsExtensions(tmpDir);

    expect(typeof result.rewritten).toBe('number');
    expect(Array.isArray(result.unresolved)).toBe(true);
  });

  it('processes an empty directory without error', () => {
    // tmpDir exists but contains no .js files
    const result = addJsExtensions(tmpDir);

    expect(result.rewritten).toBe(0);
    expect(result.unresolved).toHaveLength(0);
  });
});
