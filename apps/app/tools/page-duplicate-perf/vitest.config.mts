/**
 * Vitest config for the page-duplicate performance measurements (manual only).
 *
 * The measurement files are named `*.perf.ts` so that no project of
 * `vitest.workspace.mts` collects them; CI never runs them. This config mirrors
 * the `app-integration` project (same setup files, MongoMemoryServer with a
 * replica set) and adds `--expose-gc` plus a single fork, so that every
 * measurement runs alone in its own process.
 *
 * Usage (from apps/app, without MONGO_URI so that MongoMemoryServer is used):
 *
 *   env -u MONGO_URI PERF_SCENARIO=<scenario> \
 *     ../../node_modules/.bin/vitest run \
 *     --config tools/page-duplicate-perf/vitest.config.mts <file-name-part>
 *
 * See the header of each `*.perf.ts` file for its scenarios.
 */
import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defaultExclude, defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: appRoot,
  envDir: appRoot,
  plugins: [tsconfigPaths({ root: appRoot })],
  resolve: {
    // vite-tsconfig-paths maps aliases only for files included by tsconfig.json,
    // and tools/ is not, so the same aliases are declared here.
    alias: [
      { find: /^~\//, replacement: `${appRoot}src/` },
      { find: /^\^\//, replacement: appRoot },
    ],
    conditions: ['require', 'node', 'default'],
  },
  ssr: {
    resolve: {
      conditions: ['require', 'node', 'default'],
    },
  },
  test: {
    name: 'page-duplicate-perf',
    environment: 'node',
    globals: true,
    clearMocks: true,
    include: ['tools/page-duplicate-perf/**/*.perf.ts'],
    exclude: [...defaultExclude],
    globalSetup: ['./test/setup/mongo/global-setup.ts'],
    setupFiles: [
      './test/setup/elasticsearch.ts',
      './test/setup/migrate-mongo.ts',
      './test/setup/mongo/index.ts',
      './test/setup/prisma.ts',
    ],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true, execArgv: ['--expose-gc'] },
    },
    fileParallelism: false,
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 30 * 60 * 1000,
    deps: {
      interopDefault: true,
    },
    server: {
      deps: {
        inline: [
          '@growi/remark-attachment-refs',
          '@growi/remark-drawio',
          '@growi/remark-lsx',
          /src\/server\/events/,
        ],
      },
    },
  },
});
