/**
 * Tests for the add-import-extensions jscodeshift transform.
 *
 * Contract under test: every literal relative specifier (static import/export,
 * dynamic import(), TSImportType) gains the explicit extension of its on-disk
 * target; everything else (bare packages, aliases, already-extended, comments,
 * unresolvable paths) is left byte-identical. Resolution runs against the real
 * fixture tree in __fixtures__/add-import-extensions/.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jscodeshift from 'jscodeshift';
import { describe, expect, it } from 'vitest';

// The transform is a CommonJS module (jscodeshift transform convention).
const require = createRequire(import.meta.url);
const transform = require('./add-import-extensions.cjs');

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'add-import-extensions',
);

/**
 * Apply the transform to `source` as if it were a file at `filePath`.
 * Returns the new source, or undefined when the transform made no changes
 * (jscodeshift "skip" contract).
 *
 * `aliasRoot` is always pinned to the fixture tree so the alias resolution
 * (`~/` -> `<aliasRoot>/src/`, `^/` -> `<aliasRoot>/`) stays hermetic.
 */
function applyTransform(
  source: string,
  filePath = path.join(FIXTURES, 'entry.ts'),
): string | undefined {
  const j = jscodeshift.withParser('ts');
  const result = transform(
    { source, path: filePath },
    { jscodeshift: j, j, stats: () => {} },
    { aliasRoot: FIXTURES },
  );
  return result === undefined ? undefined : result.trim();
}

describe('static import declarations', () => {
  it('appends .js when the target is a .ts file', () => {
    expect(applyTransform(`import { foo } from './foo';`)).toBe(
      `import { foo } from './foo.js';`,
    );
  });

  it('appends .js when the target is a .js file', () => {
    expect(applyTransform(`import { bar } from './bar';`)).toBe(
      `import { bar } from './bar.js';`,
    );
  });

  it('appends .cjs when the target is a .cjs file', () => {
    expect(applyTransform(`import legacy from './legacy';`)).toBe(
      `import legacy from './legacy.cjs';`,
    );
  });

  it('appends .js when only a .d.ts declaration exists (type-only target)', () => {
    expect(applyTransform(`import type { Marker } from './types';`)).toBe(
      `import type { Marker } from './types.js';`,
    );
  });

  it('rewrites a directory import to its /index.js entry', () => {
    expect(applyTransform(`import './dir';`)).toBe(`import './dir/index.js';`);
  });

  it("rewrites the bare '.' specifier to './index.js'", () => {
    const importerInDir = path.join(FIXTURES, 'dir', 'inner.ts');
    expect(
      applyTransform(`import type { InDir } from '.';`, importerInDir),
    ).toBe(`import type { InDir } from './index.js';`);
  });

  it('reprints rewritten literals with project-standard single quotes', () => {
    expect(applyTransform(`import { foo } from "./foo";`)).toBe(
      `import { foo } from './foo.js';`,
    );
  });
});

describe('re-export declarations', () => {
  it('appends extensions to named and star re-exports', () => {
    const input = [
      `export { foo } from './foo';`,
      `export * from './dir';`,
    ].join('\n');
    expect(applyTransform(input)).toBe(
      [
        `export { foo } from './foo.js';`,
        `export * from './dir/index.js';`,
      ].join('\n'),
    );
  });
});

describe('dynamic import()', () => {
  it('appends .js to literal dynamic imports', () => {
    expect(applyTransform(`export const load = () => import('./foo');`)).toBe(
      `export const load = () => import('./foo.js');`,
    );
  });

  it('appends .json when the target is a JSON file', () => {
    expect(applyTransform(`export const load = () => import('./data');`)).toBe(
      `export const load = () => import('./data.json');`,
    );
  });

  it('leaves non-literal dynamic imports untouched', () => {
    const input = `export const load = (p: string) => import(p);`;
    expect(applyTransform(input)).toBeUndefined();
  });
});

describe('TSImportType (type-position import)', () => {
  it('appends the extension inside type references', () => {
    expect(applyTransform(`export let m: import('./types').Marker;`)).toBe(
      `export let m: import('./types.js').Marker;`,
    );
  });
});

describe('alias specifiers (~/ -> src/, ^/ -> app root) — task 3.6 NodeNext pass', () => {
  it('appends .js to a ~/ alias whose target is a .ts file under src/', () => {
    expect(applyTransform(`import { aliased } from '~/aliased';`)).toBe(
      `import { aliased } from '~/aliased.js';`,
    );
  });

  it('rewrites a ~/ alias directory import to its /index.js entry', () => {
    expect(applyTransform(`import { inSub } from '~/sub';`)).toBe(
      `import { inSub } from '~/sub/index.js';`,
    );
  });

  it('appends .js to a ^/ alias resolved against the app root', () => {
    expect(applyTransform(`import { atRoot } from '^/rootfile';`)).toBe(
      `import { atRoot } from '^/rootfile.js';`,
    );
  });

  it('appends .js to literal dynamic import() of a ~/ alias', () => {
    expect(
      applyTransform(`export const load = () => import('~/aliased');`),
    ).toBe(`export const load = () => import('~/aliased.js');`);
  });

  it('appends the extension inside TSImportType alias references', () => {
    expect(applyTransform(`export let m: import('~/aliased').T;`)).toBe(
      `export let m: import('~/aliased.js').T;`,
    );
  });

  it('leaves an already-extended ~/ alias untouched (idempotency)', () => {
    expect(applyTransform(`import { a } from '~/aliased.js';`)).toBeUndefined();
  });

  it('leaves an unresolvable ~/ alias untouched', () => {
    expect(
      applyTransform(`import { x } from '~/does/not/exist';`),
    ).toBeUndefined();
  });
});

describe('specifiers that must stay untouched', () => {
  it.each([
    ['bare package', `import express from 'express';`],
    ['unresolvable ~/ alias', `import { x } from '~/server/util/x';`],
    ['^/ alias with .cjs', `import config from '^/config/i18next.config.cjs';`],
    ['already-extended .js', `import { bar } from './bar.js';`],
    ['already-extended .json', `import data from './data.json';`],
    ['unresolvable relative path', `import { gone } from './missing';`],
  ])('%s', (_label, input) => {
    expect(applyTransform(input)).toBeUndefined();
  });

  it('does not rewrite specifiers inside comments (JSDoc import types)', () => {
    const input = [
      `/** @type {import('./foo').Foo} */`,
      `export const x = 1; // see './bar'`,
    ].join('\n');
    expect(applyTransform(input)).toBeUndefined();
  });

  it('rewrites resolvable specifiers while leaving unresolvable ones alone', () => {
    const input = [
      `import { foo } from './foo';`,
      `import { gone } from './missing';`,
    ].join('\n');
    expect(applyTransform(input)).toBe(
      [
        `import { foo } from './foo.js';`,
        `import { gone } from './missing';`,
      ].join('\n'),
    );
  });
});
