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
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import the function under test. This import is intentionally broken (file
// does not exist yet) — this is the TDD red phase.
import type { AddJsExtensionsResult } from './add-js-extensions.mjs';

const { addJsExtensions } = await import('./add-js-extensions.mjs');

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
