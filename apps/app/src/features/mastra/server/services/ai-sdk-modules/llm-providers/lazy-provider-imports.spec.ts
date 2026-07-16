import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Contract --------------------------------------------------------------
//
// Each provider resolver loads its `@ai-sdk/*` SDK (and, for Azure, the
// `@azure/identity` credential chain) via dynamic import() INSIDE the resolver
// function, so that only the provider actually resolved pays its memory cost —
// an instance configured for a single provider never loads the other three
// SDKs. That guarantee holds only while the SDKs are unreachable through the
// STATIC import graph of the providers barrel / the dispatcher: a stray
// top-level `import { createOpenAI } from '@ai-sdk/openai'` would re-load every
// provider the moment the barrel is imported (which happens as soon as the agent
// is constructed), silently undoing the optimization.
//
// This spec walks the static import graph from those entrypoints and fails if
// any chain reaches an `@ai-sdk/*` package or `@azure/identity`. Dynamic
// import() calls are treated as boundaries (not followed), matching runtime
// behavior; `import type` lines are skipped (erased at build).

const HERE = path.dirname(fileURLToPath(import.meta.url));
// llm-providers -> ai-sdk-modules -> services -> server -> mastra -> features -> src
const SRC_ROOT = path.resolve(HERE, '../../../../../..');

// The lazily-loaded provider SDKs that must never appear in the static graph.
const LAZY_ONLY_PACKAGE = /^(@ai-sdk\/|@azure\/identity$)/;

// Entrypoints whose static graph must stay free of the provider SDKs: the
// providers barrel (imported when the agent is constructed) and the dispatcher.
const ENTRYPOINTS = [
  'features/mastra/server/services/ai-sdk-modules/llm-providers/index.ts',
  'features/mastra/server/services/ai-sdk-modules/resolve-mastra-model.ts',
];

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

const traceLazyPackageChains = (): string[] => {
  const violations: string[] = [];
  const visited = new Set<string>();
  const queue: { file: string; chain: string[] }[] = ENTRYPOINTS.map(
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
        if (LAZY_ONLY_PACKAGE.test(resolved.specifier)) {
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

describe('lazy-loaded provider SDKs stay out of the static import graph', () => {
  it('no static chain from the providers barrel / dispatcher reaches @ai-sdk/* or @azure/identity', () => {
    const violations = traceLazyPackageChains();

    expect(
      violations,
      `Provider SDKs must be reached only via dynamic import() inside each resolver.\n` +
        `A static import re-loads every provider the moment the barrel is imported.\n` +
        `Move the offending import to an \`await import(...)\` inside the resolver.\n\n` +
        `${violations.join('\n\n')}`,
    ).toEqual([]);
  });

  // Guards the tracer itself: if an entrypoint is renamed/moved the walk would
  // trace nothing and pass vacuously. Requiring each to exist keeps it honest.
  it('still finds every entrypoint it traces from', () => {
    for (const entry of ENTRYPOINTS) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, entry)),
        `entrypoint disappeared: ${entry} — update ENTRYPOINTS`,
      ).toBe(true);
    }
  });
});
