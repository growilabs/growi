/**
 * Tests for the verify-dist-resolution tool (C5, esm-import-convention task 3).
 *
 * The tool statically checks that every relative import specifier in every .js
 * file under dist points to a file that actually exists. This recovers the
 * "build-time resolution guarantee" that was relaxed when moving to Bundler
 * moduleResolution.
 *
 * Test strategy (essential-test-design): verify the observable contract:
 *   - { checked: N, unresolved: [] } for a clean dist
 *   - { checked: N, unresolved: [<location>] } for a broken import
 *   - non-relative (external) specifiers are ignored
 *   - .jsx / .json / .cjs targets resolve correctly
 *   - lazy/dynamic imports are also checked
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { verifyDistResolution } = await import('./verify-dist-resolution');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'verify-dist-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string): void {
  const absPath = join(tmpDir, relPath);
  mkdirSync(absPath.slice(0, absPath.lastIndexOf('/')), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
}

// ──────────────────────────────────────────────────────────────────────────────
// Test cases
// ──────────────────────────────────────────────────────────────────────────────

describe('verify-dist-resolution: clean dist — zero unresolved', () => {
  it('reports 0 unresolved for a correctly-extensioned dist', () => {
    writeFile('a.js', `import { foo } from './b.js';`);
    writeFile('b.js', `export const foo = 1;`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(0);
    expect(result.checked).toBeGreaterThanOrEqual(1);
  });

  it('resolves index.js barrel imports', () => {
    writeFile('a.js', `import { foo } from './sub/index.js';`);
    writeFile('sub/index.js', `export const foo = 1;`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(0);
  });

  it('resolves .jsx targets (dead client emit)', () => {
    writeFile('a.js', `import Widget from './Widget.jsx';`);
    writeFile('Widget.jsx', `export default function Widget() {}`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(0);
  });

  it('ignores external (non-relative) specifiers', () => {
    writeFile(
      'a.js',
      `import mongoose from 'mongoose';\nimport express from 'express';`,
    );

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(0);
    // No relative specifiers to check
    expect(result.checked).toBe(0);
  });

  it('resolves .json specifiers', () => {
    writeFile(
      'a.js',
      `import data from './config.json' with { type: 'json' };`,
    );
    writeFile('config.json', `{"key":"value"}`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(0);
  });

  it('resolves .cjs specifiers', () => {
    writeFile('a.js', `import cfg from './legacy.cjs';`);
    writeFile('legacy.cjs', `module.exports = {};`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(0);
  });
});

describe('verify-dist-resolution: broken import — non-zero exit', () => {
  it('reports an unresolved specifier when the target file is missing', () => {
    writeFile('a.js', `import { x } from './missing.js';`);
    // missing.js does NOT exist

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toContain('missing.js');
  });

  it('reports the importer file path in the unresolved entry', () => {
    writeFile('sub/a.js', `import { x } from './ghost.js';`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved[0]).toContain('a.js');
  });

  it('reports all unresolved specifiers (not just the first)', () => {
    writeFile(
      'a.js',
      [
        `import { x } from './missing1.js';`,
        `import { y } from './missing2.js';`,
      ].join('\n'),
    );

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(2);
  });
});

describe('verify-dist-resolution: dynamic imports', () => {
  it('checks lazy/dynamic import() specifiers too', () => {
    writeFile('a.js', `const m = await import('./lazy.js');`);
    // lazy.js does NOT exist

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toContain('lazy.js');
  });

  it('accepts a present dynamic import', () => {
    writeFile('a.js', `const m = await import('./lazy.js');`);
    writeFile('lazy.js', `export const x = 1;`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(0);
  });
});

describe('verify-dist-resolution: dead .jsx emit — no false positive', () => {
  it('does not report a missing .jsx as an error if it exists', () => {
    writeFile('server.js', `import Widget from './Widget.jsx';`);
    // Widget.jsx is the dead client emit — still exists on disk
    writeFile('Widget.jsx', `export default function Widget() {}`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(0);
  });
});

describe('verify-dist-resolution: residual path-alias specifiers', () => {
  /**
   * After the tspc → tsc migration, alias-to-relative rewriting happens in
   * postbuild (add-js-extensions). A `~/` or `^/` specifier remaining in dist
   * means the rewrite step was skipped or failed — Node cannot resolve it at
   * runtime, so it must be reported as unresolved.
   */
  it('reports a residual ~/ specifier as unresolved', () => {
    writeFile('a.js', `import { foo } from '~/lib/b';`);
    writeFile('lib/b.js', `export const foo = 1;`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toContain('~/lib/b');
  });

  it('reports a residual ^/ specifier as unresolved (dynamic import too)', () => {
    writeFile('a.js', `const m = await import('^/config/app.mjs');`);

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toContain('^/config/app.mjs');
  });

  it('does not flag alias-looking strings inside comment lines', () => {
    writeFile(
      'a.js',
      [`// example: import('~/lib/b')`, `export const ok = 1;`].join('\n'),
    );

    const result = verifyDistResolution(tmpDir);

    expect(result.unresolved).toHaveLength(0);
  });
});

describe('verify-dist-resolution: return contract', () => {
  it('returns { checked: number, unresolved: string[] }', () => {
    writeFile('a.js', `import { foo } from './b.js';`);
    writeFile('b.js', `export const foo = 1;`);

    const result = verifyDistResolution(tmpDir);

    expect(typeof result.checked).toBe('number');
    expect(Array.isArray(result.unresolved)).toBe(true);
  });

  it('processes an empty directory without error', () => {
    const result = verifyDistResolution(tmpDir);

    expect(result.checked).toBe(0);
    expect(result.unresolved).toHaveLength(0);
  });
});
