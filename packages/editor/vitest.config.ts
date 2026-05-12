import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    clearMocks: true,
    globals: true,
    environment: 'happy-dom',
    include: ['**/*.{spec,integ}.{ts,tsx}'],
  },
});
