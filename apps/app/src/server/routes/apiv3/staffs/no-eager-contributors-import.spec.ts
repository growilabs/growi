import fs from 'node:fs';
import path from 'node:path';

// --- Contract --------------------------------------------------------------
//
// The staff-credit feature is rarely used, so its (larger) contributor dataset
// must not be loaded at server boot. The router is registered statically at
// boot (routes/apiv3/index.js), so the router module itself loads eagerly — but
// it must reach the contributor dataset only through a dynamic import() inside
// the request handler, never through a top-level static import. That keeps the
// dataset off the boot memory footprint of every deployment.
//
// This guards the boundary against a refactor that "simplifies" the lazy import
// back into a static one. Mutation check: replace the dynamic import in index.ts
// with `import { contributors } from './contributors'` and this spec goes RED.

const INDEX_PATH = path.resolve(import.meta.dirname, 'index.ts');

// A static import of ./contributors: `import ... from './contributors'`,
// excluding `import type ...` (erased at build) and dynamic `import('...')`.
const STATIC_IMPORT_RE =
  /^\s*import\s+(?!type\b)[^;]*?\bfrom\s+['"]\.\/contributors['"]/m;

const DYNAMIC_IMPORT_RE = /import\(\s*['"]\.\/contributors['"]\s*\)/;

describe('lazy-load boundary for the staff-credit contributor dataset', () => {
  it('has an index.ts to guard (guard-the-guard)', () => {
    expect(fs.existsSync(INDEX_PATH)).toBe(true);
  });

  it('does not statically import ./contributors from the router module', () => {
    const source = fs.readFileSync(INDEX_PATH, 'utf-8');
    expect(STATIC_IMPORT_RE.test(source)).toBe(false);
  });

  it('loads ./contributors via a dynamic import', () => {
    const source = fs.readFileSync(INDEX_PATH, 'utf-8');
    expect(DYNAMIC_IMPORT_RE.test(source)).toBe(true);
  });
});
