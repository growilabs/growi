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
// The unified / remark / rehype markdown stack must only load when a page body
// is actually extracted — not merely because the server booted. In situ it adds
// ~16 MiB RSS on top of the rest of the boot graph (31 MiB in isolation, but
// ~15 MiB of that is shared with mongoose / the page model and paid anyway).
// Extraction runs on the backlinks drain timer, off the request path, so
// `extract-internal-link-paths.ts` loads the stack with dynamic import() and nothing
// may reintroduce a top-level import.
//
// This is the only server-side consumer of that stack; the other one
// (page-bulk-export's markdown renderer) also loads it exclusively through
// dynamicImport, and every remaining consumer lives in the client/Turbopack
// graph, which is out of scope here. Before the backlinks feature, the server
// boot graph reached none of these packages.
//
// Two walks guard this from different angles:
//
// 1. From the backlinks server entry (`page-link-service.ts`, the module crowi
//    instantiates). This guards the feature's *internal* graph regardless of how
//    crowi reaches it — it keeps holding if that edge ever becomes a dynamic
//    import(), which the boot walk below would then stop crossing.
// 2. From the server's boot entrypoints (shared via `test-utils/boot-entrypoints`).
//    This is the realistic leak path, and it is wider than walk 1: the backlinks
//    HTTP route is registered from `routes/apiv3/index.js`, itself a boot
//    entrypoint, so a top-level import added to *any* boot-reachable module — not
//    just one under features/backlinks — is caught here.
//
// Dynamic import() calls are treated as boundaries (not followed). `import type`
// lines are skipped (erased at build) — the type-only `hast` import in
// extract-internal-link-paths.ts is fine and must remain.

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

// Anchored at the start so a package merely *depending* on one of these is not
// matched — only a direct specifier is a violation. Covers subpath imports too
// (e.g. 'remark-parse/lib').
const MARKDOWN_PIPELINE_PACKAGE =
  /^(unified|remark-[\w-]+|rehype-[\w-]+|hast-util-[\w-]+|mdast-util-[\w-]+|micromark[\w-]*|parse5)($|\/)/;

const BACKLINKS_ENTRYPOINTS = [
  'features/backlinks/server/services/page-link-service.ts',
];

describe('lazy-load boundary for the markdown pipeline', () => {
  it('has no static import chain from the backlinks server entry to the unified / remark / rehype stack', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: BACKLINKS_ENTRYPOINTS,
      bannedPattern: MARKDOWN_PIPELINE_PACKAGE,
    });
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      'The backlinks server entry must not statically reach the markdown pipeline.\n' +
        'Load it with a dynamic import() inside extractInternalLinkPaths (see buildPipeline) ' +
        'instead of a top-level import — including the local ~/services/renderer plugins, ' +
        'which reach hast-util-select transitively.\n\n' +
        `${formatted.join('\n\n')}`,
    ).toEqual([]);
  });

  // Guards the tracer itself: if the entrypoint were renamed/moved, the walk
  // would silently trace nothing and the boundary test above would pass
  // vacuously.
  it('still finds the backlinks entrypoint it traces from', () => {
    for (const entry of BACKLINKS_ENTRYPOINTS) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, entry)),
        `backlinks entrypoint disappeared: ${entry} — update BACKLINKS_ENTRYPOINTS`,
      ).toBe(true);
    }
  });
});

describe('boot-time import boundary for the markdown pipeline', () => {
  it('has no static import chain from a boot entrypoint to the unified / remark / rehype stack', () => {
    const violations = traceStaticImportChains({
      srcRoot: SRC_ROOT,
      entrypoints: BOOT_ENTRYPOINTS,
      bannedPattern: MARKDOWN_PIPELINE_PACKAGE,
    });
    const formatted = violations.map(formatViolation);

    expect(
      formatted,
      'Boot entrypoints must not statically reach the markdown pipeline.\n' +
        'Every deployment pays this ~16 MiB RSS at startup, including processes that ' +
        'never save a page. Load the stack with a dynamic import() at the point of use.\n\n' +
        `${formatted.join('\n\n')}`,
    ).toEqual([]);
  });

  // Guards the tracer itself: if the boot entrypoints were renamed/moved, the
  // walk would silently trace nothing and the boundary test above would pass
  // vacuously.
  it('still finds every boot entrypoint it traces from', () => {
    for (const entry of BOOT_ENTRYPOINTS) {
      expect(
        fs.existsSync(path.join(SRC_ROOT, entry)),
        `boot entrypoint disappeared: ${entry} — update BOOT_ENTRYPOINTS`,
      ).toBe(true);
    }
  });
});
