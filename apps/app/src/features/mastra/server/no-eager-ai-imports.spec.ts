import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Contract --------------------------------------------------------------
//
// The heavy AI packages (@mastra/*, @ai-sdk/*, ai, tokenlens) cost ~140MB RSS
// once imported, so they must stay OUT of the server's boot-time module graph:
// they may only be reached through dynamic import() executed after an
// AI-ready check (see routes/index.ts). This spec walks the STATIC import
// graph from the boot entrypoints and fails when any chain reaches a heavy
// package — catching regressions like a new `import { ... } from
// './ai-sdk-modules/...'` sneaking into a boot-path module.
//
// Dynamic import() calls are treated as boundaries (not followed), matching
// runtime behavior: they only load when executed. `import type` lines are
// skipped (erased at build). Mixed value/type imports are followed —
// conservative in the right direction.

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const HEAVY_PACKAGE = /^(@mastra\/|@ai-sdk\/|ai$|tokenlens)/;

// Boot-time entrypoints: the Express server side that loads unconditionally.
// (Client/SSR bundles are built by Turbopack with their own graph and load
// page-wise; they are out of scope here.)
const BOOT_ENTRYPOINTS = [
  'server/crowi/index.ts',
  'server/routes/apiv3/index.js',
  'utils/prisma.ts',
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

const traceHeavyImportChains = (): string[] => {
  const violations: string[] = [];
  const visited = new Set<string>();
  const queue: { file: string; chain: string[] }[] = BOOT_ENTRYPOINTS.map(
    (entry) => ({
      file: path.join(SRC_ROOT, entry),
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
      const resolved = resolveSpecifier(item.file, specifier);
      if (resolved.kind === 'external') {
        if (HEAVY_PACKAGE.test(resolved.specifier)) {
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

describe('boot-time import boundary for heavy AI packages', () => {
  it('has no static import chain from a boot entrypoint to @mastra / @ai-sdk / ai / tokenlens', () => {
    const violations = traceHeavyImportChains();

    expect(
      violations,
      `Boot entrypoints must not statically reach heavy AI packages.\n` +
        `Break the chain with a light intermediate module or a guarded dynamic import.\n\n` +
        `${violations.join('\n\n')}`,
    ).toEqual([]);
  });

  // Guards the tracer itself: if the entrypoints were renamed/moved, the walk
  // would silently trace nothing and the boundary test above would pass
  // vacuously. Requiring every entrypoint to exist keeps the contract honest.
  it('still finds every boot entrypoint it traces from', () => {
    for (const entry of BOOT_ENTRYPOINTS) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, entry)),
        `boot entrypoint disappeared: ${entry} — update BOOT_ENTRYPOINTS`,
      ).toBe(true);
    }
  });
});
