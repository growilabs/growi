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

const HEAVY_PACKAGE = /^(@mastra\/|@ai-sdk\/|ai$|tokenlens)/;

describe('boot-time import boundary for heavy AI packages', () => {
  it('has no static import chain from a boot entrypoint to @mastra / @ai-sdk / ai / tokenlens', () => {
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
