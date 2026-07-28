/**
 * Boot-time entrypoints of the Express server's STATIC import graph.
 *
 * Declared once here so every "drift test" that walks this graph — the
 * heavy-AI-package boundary, the mail-transport-package boundary, and any
 * future one — traces from the same work-set instead of each keeping its
 * own copy that can silently drift out of sync. Per the "declare the
 * work-set once, executors receive it as input" convention: this module owns
 * *what* to trace from; `test-utils/static-import-graph.ts` owns *how* to
 * walk it.
 *
 * (Client/SSR bundles are built by Turbopack with their own graph and load
 * page-wise; they are out of scope here.)
 */
export const BOOT_ENTRYPOINTS = [
  'server/crowi/index.ts',
  'server/routes/apiv3/index.js',
  'utils/prisma.ts',
] as const;
