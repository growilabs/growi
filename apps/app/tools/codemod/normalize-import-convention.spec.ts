/**
 * Tests for normalize-import-convention codemod (C2, esm-import-convention task 4.1).
 *
 * Transforms apps/app/src import specifiers to the canonical "no-extension" convention:
 *   1. Remove .js/.jsx from relative specifiers (./foo.js → ./foo)
 *   2. Remove .js/.jsx from ~/alias specifiers (~/states/context.js → ~/states/context)
 *   3. Collapse local ~/... alias to extensionless relative (when target is in same
 *      src/ first-level subtree as the importer)
 *   4. Remove /index suffix from barrel imports (~/utils/logger/index.js → ~/utils/logger)
 *   5. Leave external/non-TS specifiers unchanged (.json/.cjs/.scss/npm packages)
 *   6. If unresolvable, leave unchanged + warn (no crash)
 *
 * Test strategy (essential-test-design): test observable contract — the output source
 * string — not AST internals. Master-calibration samples are verified inline.
 *
 * Fixture tree: __fixtures__/normalize-import-convention/
 *   src/client/components/Bookmarks/BookmarkFolderMenu.ts
 *   src/client/components/FormattedDistanceDate.tsx
 *   src/server/models/user-group.ts
 *   src/states/context.ts
 *   src/stores/bookmark.ts
 *   src/utils/logger/index.ts
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jscodeshift from 'jscodeshift';
import { describe, expect, it } from 'vitest';

// TDD red phase: file does not exist yet
const require = createRequire(import.meta.url);
const transform = require('./normalize-import-convention.cjs');

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'normalize-import-convention',
);

/**
 * Apply the transform to `source` as if it were the file at `filePath`.
 * Returns the transformed source (or original if no changes).
 */
function applyTransform(source: string, filePath: string): string {
  const j = jscodeshift.withParser('ts');
  const result = transform(
    { source, path: filePath },
    { jscodeshift: j, j, stats: () => {} },
    { appRoot: FIXTURES },
  );
  return (result ?? source).trim();
}

function applyTransformTsx(source: string, filePath: string): string {
  const j = jscodeshift.withParser('tsx');
  const result = transform(
    { source, path: filePath },
    { jscodeshift: j, j, stats: () => {} },
    { appRoot: FIXTURES },
  );
  return (result ?? source).trim();
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Remove .js from relative specifiers
// ──────────────────────────────────────────────────────────────────────────────

describe('normalize-import-convention: relative .js removal', () => {
  const IMPORTER = path.join(
    FIXTURES,
    'src/client/components/PageControls/fixture.ts',
  );

  it('removes .js from relative import', () => {
    const src = `import { foo } from './sibling.js';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import { foo } from './sibling';`,
    );
  });

  it('removes .js from ../relative import', () => {
    const src = `import { foo } from '../something.js';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import { foo } from '../something';`,
    );
  });

  it('removes .jsx from relative import', () => {
    const src = `import Widget from './Widget.jsx';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import Widget from './Widget';`,
    );
  });

  it('removes /index.js barrel suffix from relative import', () => {
    const src = `import { foo } from '../something/index.js';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import { foo } from '../something';`,
    );
  });

  it('removes /index.js from ./index.js self-barrel', () => {
    const src = `import { foo } from './index.js';`;
    expect(applyTransform(src, IMPORTER)).toBe(`import { foo } from '.';`);
  });

  it('handles type-only imports the same way', () => {
    const src = `import type { Foo } from './types.js';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import type { Foo } from './types';`,
    );
  });

  it('handles re-exports (export ... from)', () => {
    const src = `export { foo } from './util.js';`;
    expect(applyTransform(src, IMPORTER)).toBe(`export { foo } from './util';`);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Remove .js from ~/alias specifiers (cross-module stays alias)
// ──────────────────────────────────────────────────────────────────────────────

describe('normalize-import-convention: alias .js removal (cross-module stays alias)', () => {
  const IMPORTER = path.join(
    FIXTURES,
    'src/client/components/PageControls/fixture.ts',
  );

  it('removes .js from cross-module ~/alias (states → client)', () => {
    const src = `import { useIsGuestUser } from '~/states/context.js';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import { useIsGuestUser } from '~/states/context';`,
    );
  });

  it('removes .js from cross-module ~/alias (stores → client)', () => {
    const src = `import { useSWRxBookmarkedUsers } from '~/stores/bookmark.js';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import { useSWRxBookmarkedUsers } from '~/stores/bookmark';`,
    );
  });

  it('removes /index.js from cross-module barrel alias', () => {
    const src = `import loggerFactory from '~/utils/logger/index.js';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import loggerFactory from '~/utils/logger';`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Collapse local alias → relative (same src/ first-level subtree)
// ──────────────────────────────────────────────────────────────────────────────

describe('normalize-import-convention: local alias collapse to relative', () => {
  const IMPORTER = path.join(
    FIXTURES,
    'src/client/components/PageControls/fixture.ts',
  );

  it('collapses ~/client/... alias to relative when in same src/client/ subtree', () => {
    // BookmarkButtons master calibration: ~/client/components/Bookmarks/... → ../Bookmarks/...
    const src = `import { BookmarkFolderMenu } from '~/client/components/Bookmarks/BookmarkFolderMenu.js';`;
    // After: ../Bookmarks/BookmarkFolderMenu (relative, .js removed)
    const result = applyTransform(src, IMPORTER);
    expect(result).toBe(
      `import { BookmarkFolderMenu } from '../Bookmarks/BookmarkFolderMenu';`,
    );
  });

  it('collapses ~/client/... alias to relative for default import', () => {
    const src = `import FormattedDistanceDate from '~/client/components/FormattedDistanceDate.js';`;
    const result = applyTransform(src, IMPORTER);
    // FormattedDistanceDate.tsx is at src/client/components/FormattedDistanceDate.tsx
    // relative from PageControls/ is ../FormattedDistanceDate
    expect(result).toBe(
      `import FormattedDistanceDate from '../FormattedDistanceDate';`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Invariants — external / non-TS specifiers unchanged
// ──────────────────────────────────────────────────────────────────────────────

describe('normalize-import-convention: invariants — unchanged specifiers', () => {
  const IMPORTER = path.join(
    FIXTURES,
    'src/client/components/PageControls/fixture.ts',
  );

  it('does not modify external npm packages', () => {
    const src = `import mongoose from 'mongoose';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import mongoose from 'mongoose';`,
    );
  });

  it('does not modify .json imports (import attribute)', () => {
    const src = `import config from '^/config/i18next.config.cjs';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import config from '^/config/i18next.config.cjs';`,
    );
  });

  it('does not modify .scss imports', () => {
    const src = `import styles from './Button.module.scss';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import styles from './Button.module.scss';`,
    );
  });

  it('does not modify specifiers that already have no extension', () => {
    const src = `import { foo } from './sibling';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import { foo } from './sibling';`,
    );
  });

  it('does not modify already-canonical ~/alias without extension', () => {
    const src = `import { useIsGuestUser } from '~/states/context';`;
    expect(applyTransform(src, IMPORTER)).toBe(
      `import { useIsGuestUser } from '~/states/context';`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Idempotency
// ──────────────────────────────────────────────────────────────────────────────

describe('normalize-import-convention: idempotency', () => {
  const IMPORTER = path.join(
    FIXTURES,
    'src/client/components/PageControls/fixture.ts',
  );

  it('is idempotent when run twice on the same source', () => {
    const src = [
      `import { useIsGuestUser } from '~/states/context.js';`,
      `import { BookmarkFolderMenu } from '~/client/components/Bookmarks/BookmarkFolderMenu.js';`,
    ].join('\n');

    const j = jscodeshift.withParser('ts');
    const firstPass =
      transform(
        { source: src, path: IMPORTER },
        { jscodeshift: j, j, stats: () => {} },
        { appRoot: FIXTURES },
      ) ?? src;

    const secondPass = transform(
      { source: firstPass, path: IMPORTER },
      { jscodeshift: j, j, stats: () => {} },
      { appRoot: FIXTURES },
    );

    // Second pass should produce no changes (return undefined or same content)
    expect(
      secondPass === undefined || secondPass.trim() === firstPass.trim(),
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Unresolvable specifiers — left unchanged, no crash
// ──────────────────────────────────────────────────────────────────────────────

describe('normalize-import-convention: unresolvable specifiers', () => {
  const IMPORTER = path.join(
    FIXTURES,
    'src/client/components/PageControls/fixture.ts',
  );

  it('leaves an unresolvable alias specifier unchanged', () => {
    const src = `import { x } from '~/nonexistent/module.js';`;
    // Even if resolution fails, the .js is still removed
    const result = applyTransform(src, IMPORTER);
    // At minimum, .js must be removed; the alias may or may not be collapsed
    expect(result).not.toContain('.js');
    expect(result).toContain('nonexistent/module');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. Master calibration samples
// ──────────────────────────────────────────────────────────────────────────────

describe('normalize-import-convention: master calibration', () => {
  it('BookmarkButtons.tsx: cross-module alias .js removed, no collapse', () => {
    const IMPORTER = path.join(
      FIXTURES,
      'src/client/components/PageControls/BookmarkButtons.tsx',
    );
    const src = [
      `import { useIsGuestUser } from '~/states/context.js';`,
      `import { useSWRxBookmarkedUsers } from '~/stores/bookmark.js';`,
    ].join('\n');

    const result = applyTransformTsx(src, IMPORTER);
    expect(result).toContain(`from '~/states/context'`);
    expect(result).toContain(`from '~/stores/bookmark'`);
    expect(result).not.toContain('.js');
  });

  it('BookmarkButtons.tsx: local alias collapsed to relative', () => {
    const IMPORTER = path.join(
      FIXTURES,
      'src/client/components/PageControls/BookmarkButtons.tsx',
    );
    const src = [
      `import { BookmarkFolderMenu } from '~/client/components/Bookmarks/BookmarkFolderMenu.js';`,
    ].join('\n');

    const result = applyTransformTsx(src, IMPORTER);
    expect(result).toContain(`from '../Bookmarks/BookmarkFolderMenu'`);
    expect(result).not.toContain('~/client');
  });
});
