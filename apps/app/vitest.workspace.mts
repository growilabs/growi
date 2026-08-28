import { availableParallelism } from 'node:os';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import {
  defaultExclude,
  defineConfig,
  defineWorkspace,
  mergeConfig,
} from 'vitest/config';

// Every app-integration `beforeAll` pays two CPU-heavy setup costs on
// (almost) every test file: migrate-mongo.ts spawns a `dev:migrate:up`
// child process, and crowi.ts's getInstance() does a cold Crowi init. Both
// memoize a module-level singleton, but that memoization does NOT make
// either one "once per worker" — Vitest's `forks` pool resets the module
// registry per file under the default `isolate: true` (required here: this
// project's per-file mongo teardown/reconnect in test/setup/mongo/index.ts
// conflicts with isolate: false's shared module cache — confirmed by
// reproducing the failure locally, same hazard the app-integration-vault
// project's isolate: false comment below describes for its own case). So
// this cost recurs on nearly every file, all run long, not just at worker
// startup. Vitest's default fork pool sizes itself to availableParallelism(),
// so on a CI runner (also running MongoDB and Elasticsearch as sibling
// services) multiple files' setup child processes can end up competing for
// the same cores at once — confirmed CI log for #11820/#11821/#11822 shows
// three files' getInstance() hooks timing out in the same ~1s window near
// the end of a 530s run, alongside a fourth file that succeeded but took
// 8.4s for work that normally takes ~1s. That contention, not either setup
// step being inherently slow (measured unloaded cold init is ~0.9s), is
// what pushed both hookTimeout (#11752, migrate-mongo, already 2x the
// default) and getInstance() past their limits under load. Capping fork
// count reduces how many files' worth of this recurring cost can land on
// the runner at the same moment; it does not make the cost itself go away
// (that would require making the singleton a real per-worker singleton,
// which isolate: false would give us if it didn't conflict with the mongo
// setup above — left as a follow-up, not attempted here).
const integrationMaxForks = Math.max(1, availableParallelism() - 1);

const configShared = defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    clearMocks: true,
    globals: true,
    exclude: [...defaultExclude, 'playwright/**', 'tmp/**'],
  },
});

export default defineWorkspace([
  // unit test
  mergeConfig(configShared, {
    test: {
      name: 'app-unit',
      environment: 'node',
      include: ['**/*.spec.{ts,js}'],
    },
  }),

  // integration test
  mergeConfig(configShared, {
    resolve: {
      // Prefer require (CJS) for server-side packages
      conditions: ['require', 'node', 'default'],
    },
    ssr: {
      resolve: {
        // Vite 6+: SSR uses ssr.resolve.conditions (default: ['node', 'import']).
        // Override to match resolve.conditions so CJS-only server packages resolve correctly.
        conditions: ['require', 'node', 'default'],
      },
    },
    test: {
      name: 'app-integration',
      environment: 'node',
      include: ['**/*.integ.ts'],
      // Vault E2E tests live in their own project below — they need extra setup
      // (spawning vault-manager, mounting express, seeding users) that the
      // generic app-integration project should not pay for.
      // `*.exclusive.integ.ts` likewise belongs to its own project below: those
      // tests empty whole collections, which would destroy the fixtures of any
      // other file sharing the same per-worker database.
      exclude: [
        ...defaultExclude,
        'playwright/**',
        'tmp/**',
        'src/features/growi-vault/__tests__/**',
        '**/*.exclusive.integ.ts',
      ],
      // Pre-download the MongoDB binary before workers start to avoid lock-file race conditions
      globalSetup: ['./test/setup/mongo/global-setup.ts'],
      setupFiles: [
        './test/setup/elasticsearch.ts',
        './test/setup/migrate-mongo.ts',
        './test/setup/mongo/index.ts',
        './test/setup/prisma.ts',
      ],
      // See integrationMaxForks above: bounds concurrent cold-init contention
      // rather than widening hookTimeout around it.
      pool: 'forks',
      poolOptions: {
        forks: { maxForks: integrationMaxForks },
      },
      deps: {
        // Transform inline modules (allows ESM in require context)
        interopDefault: true,
      },
      server: {
        deps: {
          // Inline workspace packages that use CJS format
          inline: [
            '@growi/remark-attachment-refs',
            '@growi/remark-drawio',
            '@growi/remark-lsx',
            /src\/server\/events/,
          ],
        },
      },
    },
  }),

  // integration test that empties whole collections (separate project).
  //
  // The per-worker test database is shared by every file a worker runs, and the other
  // integration tests clean up by deleting their own prefixed fixtures. A test that
  // empties a collection wholesale — which the transfer's replace path forces, `configs`
  // above all — would take those fixtures with it. `testDbNamespace` is what keeps them
  // apart: it puts these files on `growi_test_exclusive_<n>`, a name no worker of any
  // other project is ever given (see test/setup/mongo/test-db-config.ts).
  //
  // Everything else is deliberately identical to app-integration. Giving this project a
  // fork of its own instead (`pool: 'forks'` + `singleFork`) puts all of its files in one
  // worker, where the mongo setup's per-file teardown stops the in-memory server the next
  // file then tries to use — so the isolation has to come from the database name, not
  // from the worker.
  mergeConfig(configShared, {
    resolve: {
      conditions: ['require', 'node', 'default'],
    },
    ssr: {
      resolve: {
        conditions: ['require', 'node', 'default'],
      },
    },
    test: {
      name: 'app-integration-exclusive',
      environment: 'node',
      include: ['**/*.exclusive.integ.ts'],
      exclude: [...defaultExclude, 'playwright/**', 'tmp/**'],
      provide: { testDbNamespace: 'exclusive' },
      globalSetup: ['./test/setup/mongo/global-setup.ts'],
      setupFiles: [
        './test/setup/elasticsearch.ts',
        './test/setup/migrate-mongo.ts',
        './test/setup/mongo/index.ts',
        './test/setup/prisma.ts',
      ],
      // Same setupFiles as app-integration — same contention, same fix.
      pool: 'forks',
      poolOptions: {
        forks: { maxForks: integrationMaxForks },
      },
      deps: { interopDefault: true },
      server: {
        deps: {
          inline: [/src\/server\/events/],
        },
      },
    },
  }),

  // vault E2E integration test (separate project: extra setup spawns
  // vault-manager and mounts the gateway router on a test Express server).
  mergeConfig(configShared, {
    resolve: {
      conditions: ['require', 'node', 'default'],
    },
    ssr: {
      resolve: {
        conditions: ['require', 'node', 'default'],
      },
    },
    test: {
      name: 'app-integration-vault',
      environment: 'node',
      include: ['src/features/growi-vault/__tests__/*.integ.ts'],
      globalSetup: ['./test/setup/mongo/global-setup.ts'],
      setupFiles: [
        // Vault E2E seeds the schemas it needs directly via mongoose factory
        // calls — no migrate-mongo dependency. Skipping migrate-mongo also
        // avoids the cross-file MONGO_URI carryover that breaks the second
        // file's setup when the first file's mongo-memory-server is stopped.
        './test/setup/mongo/index.ts',
        './test/setup/vault-e2e/index.ts',
      ],
      // Vault provisioning is process-wide; running tests in a single fork
      // avoids spinning up multiple vault-managers / Express servers.
      // isolate=false reuses the module cache across files so mongoose model
      // registrations (Comment, Page, etc.) are not re-executed and conflict.
      pool: 'forks',
      poolOptions: {
        forks: { singleFork: true },
      },
      isolate: false,
      // Timeout is generous to accommodate first-run vault-manager startup
      // (~3-5s) and the bootstrap polling loop.
      testTimeout: 60_000,
      hookTimeout: 5 * 60 * 1000,
      deps: { interopDefault: true },
      server: {
        deps: {
          inline: [/src\/server\/events/],
        },
      },
    },
  }),

  // component test
  mergeConfig(configShared, {
    plugins: [react()],
    test: {
      name: 'app-components',
      environment: 'happy-dom',
      include: ['**/*.spec.{tsx,jsx}'],
      setupFiles: ['./test/setup/jest-dom.ts'],
    },
  }),
]);
