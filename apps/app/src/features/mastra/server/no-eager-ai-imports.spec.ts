import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BOOT_ENTRYPOINTS } from '~/test-utils/boot-entrypoints';
import {
  formatViolation,
  traceStaticImportChains,
} from '~/test-utils/static-import-graph';

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
//
// The walk itself (extension resolution, `~/` alias handling, type-import
// skipping, dynamic-import boundary) lives in the shared
// `test-utils/static-import-graph` helper; the boot entrypoints live in
// `test-utils/boot-entrypoints` (shared with the mail-transport boundary
// spec); this spec only supplies the banned-package pattern.

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

// `openai` and `@azure/identity` (+25 / +28 MiB RSS each, measured) were
// boot-loaded through the legacy features/openai client-delegator until its
// removal in #11293; banning them here keeps them from being reintroduced.
// Their legitimate remaining uses are all behind dynamic import() boundaries
// (the mastra azure resolver, the lazily-loaded file-uploader/azure).
const HEAVY_PACKAGE =
  /^(@mastra\/|@ai-sdk\/|ai$|tokenlens|openai(\/|$)|@azure\/identity(\/|$))/;

describe('boot-time import boundary for heavy AI packages', () => {
  it('has no static import chain from a boot entrypoint to @mastra / @ai-sdk / ai / tokenlens / openai / @azure/identity', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: BOOT_ENTRYPOINTS,
      bannedPattern: HEAVY_PACKAGE,
    });
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      `Boot entrypoints must not statically reach heavy AI packages.\n` +
        `Break the chain with a light intermediate module or a guarded dynamic import.\n\n` +
        `${formatted.join('\n\n')}`,
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

// The public usage API is mounted ahead of aiReadyGuard (apiv3/index.js), so
// it must stay loadable without the AI stack even if the boot entrypoint list
// changes. Roots are traced on their own, independent of BOOT_ENTRYPOINTS.
const AI_USAGE_PUBLIC_API_ROOTS = [
  'features/ai-usage/server/index.ts',
  'features/ai-usage/server/routes/apiv3/ai-usage.ts',
] as const;

describe('import boundary for the public AI usage API', () => {
  it('has no static import chain from the public usage API to heavy AI packages', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: AI_USAGE_PUBLIC_API_ROOTS,
      bannedPattern: HEAVY_PACKAGE,
    });
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      `The public usage API must not statically reach heavy AI packages.\n\n` +
        `${formatted.join('\n\n')}`,
    ).toEqual([]);
  });

  it('still finds every public usage API root it traces from', () => {
    for (const root of AI_USAGE_PUBLIC_API_ROOTS) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, root)),
        `public usage API root disappeared: ${root} — update AI_USAGE_PUBLIC_API_ROOTS`,
      ).toBe(true);
    }
  });
});
