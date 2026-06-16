/**
 * Tests for import-extension-guard lint tool (C3, esm-import-convention task 6).
 *
 * The guard detects relative and ~/alias specifiers that contain .js or .jsx
 * extensions, which violate the canonical "no-extension" import convention.
 *
 * Test strategy (essential-test-design): verify the observable contract — the
 * array of violation objects returned by collectViolations() — not internals.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// TDD red phase: file does not exist yet
const require = createRequire(import.meta.url);
const { collectViolations } = require('./import-extension-guard.cjs');

/**
 * Collect violation rule names from source string (file path irrelevant for logic).
 */
const check = (source: string): string[] =>
  collectViolations(source, 'fixture.ts').map((v: { rule: string }) => v.rule);

// ──────────────────────────────────────────────────────────────────────────────
// Violations: .js/.jsx in relative specifiers
// ──────────────────────────────────────────────────────────────────────────────

describe('import-extension-guard: violations — .js in relative specifiers', () => {
  it('detects .js in static relative import', () => {
    expect(check(`import { foo } from './foo.js';`)).toContain(
      'import-extension',
    );
  });

  it('detects .js in ../relative import', () => {
    expect(check(`import { foo } from '../bar.js';`)).toContain(
      'import-extension',
    );
  });

  it('detects .jsx in relative import', () => {
    expect(check(`import Widget from './Widget.jsx';`)).toContain(
      'import-extension',
    );
  });

  it('detects .js in type-only relative import', () => {
    expect(check(`import type { Foo } from './types.js';`)).toContain(
      'import-extension',
    );
  });

  it('detects .js in export ... from relative', () => {
    expect(check(`export { foo } from './util.js';`)).toContain(
      'import-extension',
    );
  });

  it('detects .js in dynamic import()', () => {
    expect(check(`const m = await import('./lazy.js');`)).toContain(
      'import-extension',
    );
  });
});

describe('import-extension-guard: violations — .js in ~/alias specifiers', () => {
  it('detects .js in ~/alias import', () => {
    expect(check(`import { ctx } from '~/states/context.js';`)).toContain(
      'import-extension',
    );
  });

  it('detects .jsx in ~/alias import', () => {
    expect(check(`import Comp from '~/components/Foo.jsx';`)).toContain(
      'import-extension',
    );
  });

  it('detects .js in type-only ~/alias import', () => {
    expect(check(`import type { T } from '~/interfaces/page.js';`)).toContain(
      'import-extension',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Allowed: canonical imports (no extension in relative/alias)
// ──────────────────────────────────────────────────────────────────────────────

describe('import-extension-guard: allowed — canonical (no extension)', () => {
  it('accepts relative import without extension', () => {
    expect(check(`import { foo } from './foo';`)).not.toContain(
      'import-extension',
    );
  });

  it('accepts ~/alias import without extension', () => {
    expect(check(`import { ctx } from '~/states/context';`)).not.toContain(
      'import-extension',
    );
  });

  it('accepts type-only import without extension', () => {
    expect(check(`import type { T } from './types';`)).not.toContain(
      'import-extension',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Allowed: invariant specifiers (.cjs / .json / .scss / external)
// ──────────────────────────────────────────────────────────────────────────────

describe('import-extension-guard: allowed — invariant specifiers', () => {
  it('does not flag .cjs imports', () => {
    expect(
      check(`import cfg from '^/config/i18next.config.cjs';`),
    ).not.toContain('import-extension');
  });

  it('does not flag .json imports', () => {
    expect(
      check(`import data from './data.json' with { type: 'json' };`),
    ).not.toContain('import-extension');
  });

  it('does not flag .scss imports', () => {
    expect(check(`import styles from './Button.module.scss';`)).not.toContain(
      'import-extension',
    );
  });

  it('does not flag external npm packages', () => {
    expect(check(`import mongoose from 'mongoose';`)).not.toContain(
      'import-extension',
    );
  });

  it('does not flag external packages with .js in their path', () => {
    // e.g. nodemailer/lib/smtp-transport/index.js — external, not relative
    expect(
      check(`import type T from 'nodemailer/lib/smtp-transport/index.js';`),
    ).not.toContain('import-extension');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Violation structure
// ──────────────────────────────────────────────────────────────────────────────

describe('import-extension-guard: violation object structure', () => {
  it('returns violation with file, line, rule, detail', () => {
    const violations = collectViolations(
      `import { foo } from './foo.js';`,
      'src/server/service/test.ts',
    );
    expect(violations).toHaveLength(1);
    const v = violations[0];
    expect(v).toHaveProperty('file', 'src/server/service/test.ts');
    expect(v).toHaveProperty('line');
    expect(typeof v.line).toBe('number');
    expect(v).toHaveProperty('rule', 'import-extension');
    expect(v).toHaveProperty('detail');
    expect(v.detail).toContain('.js');
  });

  it('returns empty array for clean source', () => {
    const violations = collectViolations(
      `import { foo } from './foo';`,
      'fixture.ts',
    );
    expect(violations).toHaveLength(0);
  });

  it('reports multiple violations from the same file', () => {
    const src = [
      `import { a } from './a.js';`,
      `import { b } from './b.js';`,
    ].join('\n');
    const violations = collectViolations(src, 'fixture.ts');
    expect(violations).toHaveLength(2);
  });
});
