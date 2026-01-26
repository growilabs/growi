import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig, defineWorkspace, mergeConfig } from 'vitest/config';

const configShared = defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    clearMocks: true,
    globals: true,
    exclude: ['playwright/**'],
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
    test: {
      name: 'app-integration',
      environment: 'node',
      include: ['**/*.integ.ts'],
      setupFiles: [
        './test/setup/migrate-mongo.ts',
        './test/setup/mongo/index.ts',
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
