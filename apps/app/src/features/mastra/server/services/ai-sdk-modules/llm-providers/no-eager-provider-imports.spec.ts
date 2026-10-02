import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatViolation,
  traceStaticImportChains,
} from '~/test-utils/static-import-graph';

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
// This spec walks the static import graph from those entrypoints (shared
// tracer: `~/test-utils/static-import-graph`) and fails if any chain reaches an
// `@ai-sdk/*` package or `@azure/identity`. Dynamic import() calls are treated
// as boundaries (not followed), matching runtime behavior; `import type` lines
// are skipped (erased at build).

// features/mastra/server/services/ai-sdk-modules/llm-providers -> src
const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../..',
);

// The lazily-loaded provider SDKs that must never appear in the static graph.
// `(\/|$)` matches subpath imports (`@azure/identity/…`) as well as the bare
// package, without matching other `@azure/identity-*` packages.
const LAZY_ONLY_PACKAGE = /^(@ai-sdk\/|@azure\/identity(\/|$))/;

// Entrypoints whose static graph must stay free of the provider SDKs: the
// providers barrel, the dispatcher, and the Mastra instance module (the agent
// construction root — its graph covers growi-agent and the agents' tools and
// memory, so a stray provider import anywhere in the agent graph is caught,
// not only one inside llm-providers).
const ENTRYPOINTS = [
  'features/mastra/server/services/ai-sdk-modules/llm-providers/index.ts',
  'features/mastra/server/services/ai-sdk-modules/resolve-mastra-model.ts',
  'features/mastra/server/services/mastra-modules/index.ts',
];

describe('lazy-loaded provider SDKs stay out of the static import graph', () => {
  it('no static chain from the providers barrel / dispatcher reaches @ai-sdk/* or @azure/identity', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: ENTRYPOINTS,
      bannedPattern: LAZY_ONLY_PACKAGE,
    });
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      `Provider SDKs must be reached only via dynamic import() inside each resolver.\n` +
        `A static import re-loads every provider the moment the barrel is imported.\n` +
        `Move the offending import to an \`await import(...)\` inside the resolver.\n\n` +
        `${formatted.join('\n\n')}`,
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
