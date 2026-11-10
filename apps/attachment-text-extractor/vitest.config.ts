import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.{test,spec,integ}.?(c|m)[jt]s?(x)'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: (process.env.BLACKBOX_URL ?? '') === '',
  },
});
