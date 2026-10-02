import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    clearMocks: true,
    globals: true,
    environmentMatchGlobs: [
      // Use jsdom for client-side tests
      ['**/client/**/*.spec.ts', 'jsdom'],
      ['**/client/**/*.test.ts', 'jsdom'],
    ],
  },
});
