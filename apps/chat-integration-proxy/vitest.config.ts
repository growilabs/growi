import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    clearMocks: true,
    globals: true,
    // *.integ.ts needs a live PostgreSQL connection (task 1.2); *.spec.ts does not.
    // Same include-list shape as apps/growi-vault-manager's vitest.config.ts.
    include: ['src/**/*.spec.ts', 'src/**/*.integ.ts'],
  },
});
