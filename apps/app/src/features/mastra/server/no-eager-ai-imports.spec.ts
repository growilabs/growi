import {
  listMissingEntrypoints,
  traceForbiddenPackageChains,
} from './test-utils';

// --- Contract --------------------------------------------------------------
//
// The heavy AI packages (@mastra/*, @ai-sdk/*, ai, tokenlens) cost ~140MB RSS
// once imported, so they must stay OUT of the server's boot-time module graph:
// they may only be reached through dynamic import() executed after an
// AI-ready check (see routes/index.ts). This spec walks the STATIC import
// graph from the boot entrypoints (shared tracer: ./test-utils) and fails
// when any chain reaches a heavy package — catching regressions like a new
// `import { ... } from './ai-sdk-modules/...'` sneaking into a boot-path
// module.

const HEAVY_PACKAGE = /^(@mastra\/|@ai-sdk\/|ai$|tokenlens)/;

// Boot-time entrypoints: the Express server side that loads unconditionally.
// (Client/SSR bundles are built by Turbopack with their own graph and load
// page-wise; they are out of scope here.)
const BOOT_ENTRYPOINTS = [
  'server/crowi/index.ts',
  'server/routes/apiv3/index.js',
  'utils/prisma.ts',
];

describe('boot-time import boundary for heavy AI packages', () => {
  it('has no static import chain from a boot entrypoint to @mastra / @ai-sdk / ai / tokenlens', () => {
    const violations = traceForbiddenPackageChains({
      entrypoints: BOOT_ENTRYPOINTS,
      forbiddenPackages: HEAVY_PACKAGE,
    });

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
    expect(
      listMissingEntrypoints(BOOT_ENTRYPOINTS),
      'boot entrypoint disappeared — update BOOT_ENTRYPOINTS',
    ).toEqual([]);
  });
});
