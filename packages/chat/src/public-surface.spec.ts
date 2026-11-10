import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Minimal static-import-graph walk, scoped to this one drift check: does
 * `src/index.ts` (the client-safe entry point) ever statically reach
 * `node:crypto`?
 *
 * `apps/app/src/test-utils/static-import-graph.ts` has a general-purpose
 * version of this walker, but `@growi/chat` cannot depend on `apps/app`
 * code (see design.md's Allowed Dependencies table), so this is a small,
 * task-local port of the same approach: follow relative (`./`, `../`) and
 * `~/`-aliased (tsconfig path alias, resolved relative to `src/`) imports,
 * stripping a trailing `.js`/`.jsx`/`.mjs`/`.cjs` module extension so an
 * on-disk `.ts`/`.tsx` file still resolves; treat any other specifier as
 * external; skip `import type`; treat dynamic `import()` as a boundary
 * (never followed); and FAIL the test if a relative-looking specifier
 * cannot be resolved to a file on disk, rather than silently skipping it.
 */

const SRC_ROOT = path.resolve(__dirname);
const EXTENSIONS = ['.ts', '.tsx'];

// Static imports only: `import ... from 'x'`, `export ... from 'x'`, bare
// `import 'x'`. Skips `import type`; dynamic import() never matches.
const STATIC_IMPORT_RE =
  /^\s*(?:import|export)\s+(?!type[\s{])[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;

type Resolved =
  | { kind: 'file'; file: string }
  | { kind: 'external'; specifier: string }
  | { kind: 'unresolved' };

// Trailing JS/TS module extensions this repo's TypeScript writes on relative
// specifiers (e.g. `./leaf.js` resolving to the on-disk `leaf.ts`), per
// packages/slack and packages/core convention (154 relative imports, all
// `.js`-suffixed).
const JS_MODULE_EXTENSION_RE = /\.(js|jsx|mjs|cjs)$/;

const resolveSpecifier = (fromFile: string, specifier: string): Resolved => {
  const isRelative = specifier.startsWith('.');
  // `~/*` is a tsconfig path alias mapped to `./src/*` (see
  // packages/chat/tsconfig.json `paths`), resolved at runtime by
  // vite-tsconfig-paths. Treat it as relative-to-src rather than external so
  // it gets walked and checked against the banned-module pattern.
  const isAliased = specifier.startsWith('~/');
  if (!isRelative && !isAliased) {
    return { kind: 'external', specifier };
  }

  const base = isAliased
    ? path.join(SRC_ROOT, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);

  // Strip a trailing JS/TS module extension and re-run candidate resolution
  // against the stripped form, so `./leaf.js` resolves to `leaf.ts` on disk.
  const strippedBase = base.replace(JS_MODULE_EXTENSION_RE, '');
  const basesToTry = strippedBase === base ? [base] : [strippedBase, base];

  for (const candidateBase of basesToTry) {
    for (const ext of ['', ...EXTENSIONS]) {
      const candidate = candidateBase + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { kind: 'file', file: candidate };
      }
    }
    for (const ext of EXTENSIONS) {
      const candidate = path.join(candidateBase, `index${ext}`);
      if (fs.existsSync(candidate)) {
        return { kind: 'file', file: candidate };
      }
    }
  }
  return { kind: 'unresolved' };
};

/**
 * Returns the import chain down to the first banned specifier reached, or
 * undefined if none is reachable. Throws if a relative-looking (`.` or
 * `~/`) specifier cannot be resolved to a file on disk -- an unresolvable
 * import is a gate failure, not a pass.
 */
const findBannedImportChain = (
  entryFile: string,
  bannedPattern: RegExp,
): readonly string[] | undefined => {
  const visited = new Set<string>();
  const queue: { file: string; chain: string[] }[] = [
    { file: entryFile, chain: [path.relative(SRC_ROOT, entryFile)] },
  ];

  while (queue.length > 0) {
    const item = queue.shift();
    if (item == null || visited.has(item.file)) continue;
    visited.add(item.file);

    let text: string;
    try {
      text = fs.readFileSync(item.file, 'utf8');
    } catch {
      continue;
    }

    for (const match of text.matchAll(STATIC_IMPORT_RE)) {
      const specifier = match[1] ?? match[2];
      if (specifier == null) continue;
      const resolved = resolveSpecifier(item.file, specifier);
      if (resolved.kind === 'external') {
        if (bannedPattern.test(resolved.specifier)) {
          return [...item.chain, resolved.specifier];
        }
        continue;
      }
      if (resolved.kind === 'unresolved') {
        // A relative-looking (`.` or `~/`) specifier that doesn't resolve to
        // a file on disk is a gate failure, not a pass: if we can't tell
        // what it points to, we can't vouch it doesn't reach node:crypto.
        throw new Error(
          `public-surface.spec.ts: cannot resolve import specifier '${specifier}' ` +
            `from '${path.relative(SRC_ROOT, item.file)}'. The static import-graph ` +
            'walker only understands relative (./, ../) and ~/-aliased specifiers ' +
            'that point at an existing file; fix the import or extend the walker.',
        );
      }
      if (resolved.kind === 'file' && !visited.has(resolved.file)) {
        queue.push({
          file: resolved.file,
          chain: [...item.chain, path.relative(SRC_ROOT, resolved.file)],
        });
      }
    }
  }

  return undefined;
};

describe('client-safe public entry point (src/index.ts)', () => {
  it('never statically reaches node:crypto (server-only code must not leak into the client bundle)', () => {
    const chain = findBannedImportChain(
      path.join(SRC_ROOT, 'index.ts'),
      /^(node:)?crypto$/,
    );
    expect(chain).toBeUndefined();
  });
});
