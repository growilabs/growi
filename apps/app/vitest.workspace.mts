import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import {
  defaultExclude,
  defineConfig,
  defineWorkspace,
  mergeConfig,
} from 'vitest/config';

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
      exclude: [
        ...defaultExclude,
        'playwright/**',
        'tmp/**',
        'src/features/growi-vault/__tests__/**',
      ],
      // Pre-download the MongoDB binary before workers start to avoid lock-file race conditions
      globalSetup: ['./test/setup/mongo/global-setup.ts'],
      setupFiles: [
        './test/setup/elasticsearch.ts',
        './test/setup/migrate-mongo.ts',
        './test/setup/mongo/index.ts',
        './test/setup/prisma.ts',
      ],
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
      // happy-dom + React accumulate heap across the many component spec files a
      // reused worker handles; the default ~4GB ceiling is reached and the
      // worker OOMs. Raise the per-fork heap limit to give headroom, and cap the
      // fork count so total memory (maxForks * heap) stays within the CI runner
      // RAM regardless of its core count.
      pool: 'forks',
      poolOptions: {
        forks: {
          execArgv: ['--max-old-space-size=6144'],
          maxForks: 2,
        },
      },
    },
  }),
]);
