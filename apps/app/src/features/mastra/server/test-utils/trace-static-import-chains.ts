import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared static-import-graph tracer backing the import-boundary guard specs
// (no-eager-ai-imports.spec.ts, lazy-provider-imports.spec.ts): walks the
// STATIC import graph from a set of entrypoints and reports every chain that
// reaches an external package matching the given pattern.
//
// Dynamic import() calls are treated as boundaries (not followed), matching
// runtime behavior: they only load when executed. `import type` lines are
// skipped (erased at build). Mixed value/type imports are followed —
// conservative in the right direction.
//
// The tracer owns only the MECHANISM. Which entrypoints to walk and which
// packages must stay unreachable is each spec's own declaration, passed in as
// input (see .claude/rules/coding-style.md — "Executors Take Their Work-Set
// as Input").

// test-utils -> server -> mastra -> features -> src
const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

type Resolved =
  | { kind: 'file'; file: string }
  | { kind: 'external'; specifier: string }
  | { kind: 'unresolved' };

const resolveSpecifier = (fromFile: string, specifier: string): Resolved => {
  let base: string;
  if (specifier.startsWith('~/')) {
    base = path.join(SRC_ROOT, specifier.slice(2));
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

// Static imports only: `import ... from 'x'`, `export ... from 'x'`, bare
// `import 'x'`. Skips `import type`; dynamic import() never matches.
const STATIC_IMPORT_RE =
  /^\s*(?:import|export)\s+(?!type[\s{])[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;

export interface StaticImportTraceInput {
  /** Entrypoint files (src-relative) whose static import graph is walked. */
  readonly entrypoints: readonly string[];
  /** External package specifiers that must stay unreachable. */
  readonly forbiddenPackages: RegExp;
}

/**
 * Walk the static import graph from each entrypoint and return one formatted
 * chain (`entry -> ... -> file => package`) per import of a forbidden package.
 * An empty result means the boundary holds.
 */
export const traceForbiddenPackageChains = ({
  entrypoints,
  forbiddenPackages,
}: StaticImportTraceInput): string[] => {
  const violations: string[] = [];
  const visited = new Set<string>();
  const queue: { file: string; chain: string[] }[] = entrypoints.map(
    (entry) => ({ file: path.join(SRC_ROOT, entry), chain: [entry] }),
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
      const resolved = resolveSpecifier(item.file, specifier);
      if (resolved.kind === 'external') {
        if (forbiddenPackages.test(resolved.specifier)) {
          violations.push(
            `${item.chain.join('\n  -> ')}\n  => ${resolved.specifier}`,
          );
        }
        continue;
      }
      if (resolved.kind === 'file' && !visited.has(resolved.file)) {
        queue.push({
          file: resolved.file,
          chain: [...item.chain, path.relative(SRC_ROOT, resolved.file)],
        });
      }
    }
  }

  return violations;
};

/**
 * Entrypoints that do not exist on disk. Guards callers against a vacuous
 * pass: a renamed/moved entrypoint would otherwise silently trace nothing.
 * A non-empty result means the caller's declaration needs updating.
 */
export const listMissingEntrypoints = (
  entrypoints: readonly string[],
): string[] =>
  entrypoints.filter((entry) => !fs.existsSync(path.join(SRC_ROOT, entry)));
