import tsconfigPaths from 'vite-tsconfig-paths';
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    clearMocks: true,
    globals: true,
    coverage: {
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/v4/interfaces/**',
        'src/**/index.ts',
      ],
      thresholds: {
        statements: 47.59,
        branches: 89.47,
        lines: 47.59,
        functions: 66.66,
      },
    },
  },
});
