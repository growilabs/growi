/**
 * Static-import-graph walker.
 *
 * Extracted from `features/mastra/server/no-eager-ai-imports.spec.ts` so that
 * other "drift tests" (e.g. the mail service's transport-loading boundary)
 * can reuse the same walk logic against a different entrypoint set / banned
 * package pattern, without duplicating the parsing and resolution rules.
 *
 * Per the "executors take their work-set as input" convention, the walker
 * owns *how* to walk (extension resolution, `~/` alias handling, type-import
 * skipping, dynamic-import boundary) but never *what* to walk — the caller
 * supplies `srcRoot`, `entrypoints`, and `bannedPattern`.
 */

import fs from 'node:fs';
import path from 'node:path';

/** A static import chain from an entrypoint down to a banned specifier. */
export type ImportChainViolation = {
  /** The banned external specifier reached by this chain (e.g. 'nodemailer'). */
  readonly specifier: string;
  /** File chain, relative to srcRoot, from the entrypoint to the importing file. */
  readonly chain: readonly string[];
};

export type StaticImportGraphParams = {
  /** Absolute path that entrypoints and relative/`~/` specifiers resolve against. */
  readonly srcRoot: string;
  /** Entrypoint files, relative to srcRoot, to start walking from. */
  readonly entrypoints: readonly string[];
  /** Tested against each externally-resolved specifier; a match is a violation. */
  readonly bannedPattern: RegExp;
};

type Resolved =
  | { kind: 'file'; file: string }
  | { kind: 'external'; specifier: string }
  | { kind: 'unresolved' };

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

// Static imports only: `import ... from 'x'`, `export ... from 'x'`, bare
// `import 'x'`. Skips `import type`; dynamic import() never matches.
const STATIC_IMPORT_RE =
  /^\s*(?:import|export)\s+(?!type[\s{])[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;

const resolveSpecifier = (
  srcRoot: string,
  fromFile: string,
  specifier: string,
): Resolved => {
  let base: string;
  if (specifier.startsWith('~/')) {
    base = path.join(srcRoot, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return { kind: 'external', specifier };
  }
  for (const ext of ['', ...EXTENSIONS]) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return { kind: 'file', file: candidate };
    }
  }
  for (const ext of EXTENSIONS) {
    const candidate = path.join(base, `index${ext}`);
    if (fs.existsSync(candidate)) {
      return { kind: 'file', file: candidate };
    }
  }
  return { kind: 'unresolved' };
};

/**
 * Walks the STATIC import graph from `entrypoints` and reports every chain
 * that reaches an external specifier matching `bannedPattern`.
 *
 * Dynamic `import()` calls are treated as boundaries (not followed), matching
 * runtime behavior: they only load when executed. `import type` lines are
 * skipped (erased at build). Mixed value/type imports are followed —
 * conservative in the right direction.
 */
export const traceStaticImportChains = ({
  srcRoot,
  entrypoints,
  bannedPattern,
}: StaticImportGraphParams): ImportChainViolation[] => {
  const violations: ImportChainViolation[] = [];
  const visited = new Set<string>();
  const queue: { file: string; chain: string[] }[] = entrypoints.map(
    (entry) => ({
      file: path.join(srcRoot, entry),
      chain: [entry],
    }),
  );

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
      const resolved = resolveSpecifier(srcRoot, item.file, specifier);
      if (resolved.kind === 'external') {
        if (bannedPattern.test(resolved.specifier)) {
          violations.push({ specifier: resolved.specifier, chain: item.chain });
        }
        continue;
      }
      if (resolved.kind === 'file' && !visited.has(resolved.file)) {
        queue.push({
          file: resolved.file,
          chain: [...item.chain, path.relative(srcRoot, resolved.file)],
        });
      }
    }
  }

  return violations;
};

/** Formats a violation as a human-readable chain: `a -> b -> c => banned-pkg`. */
export const formatViolation = (violation: ImportChainViolation): string =>
  `${violation.chain.join('\n  -> ')}\n  => ${violation.specifier}`;
